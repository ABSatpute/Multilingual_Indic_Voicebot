# Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

from aws_cdk import (
    Stack,
    CfnOutput,
    RemovalPolicy,
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_elasticloadbalancingv2 as elbv2,
    aws_iam as iam,
    aws_logs as logs,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
)
from constructs import Construct
from aws_cdk.aws_ecr_assets import Platform
import cdk_nag


class InfraStack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        account = Stack.of(self).account

        kb_id        = self.node.try_get_context("knowledgebase")   # ap-south-1 KB
        kb_region    = self.node.try_get_context("kb_region")        # ap-south-1
        kb_model_arn = self.node.try_get_context("kb_model_arn")     # Nova Micro inference profile ARN

        # ── VPC ──────────────────────────────────────────────────────────
        vpc = ec2.Vpc(
            self, "VoicebotVPC",
            max_azs=1,
            nat_gateways=1,
            subnet_configuration=[
                ec2.SubnetConfiguration(
                    name="Public",
                    subnet_type=ec2.SubnetType.PUBLIC,
                    cidr_mask=24,
                ),
                ec2.SubnetConfiguration(
                    name="Private",
                    subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidr_mask=24,
                ),
            ],
        )

        # ── ECS Cluster ───────────────────────────────────────────────────
        cluster = ecs.Cluster(self, "VoicebotCluster", vpc=vpc, cluster_name="voicebot-cluster")

        task_definition = ecs.FargateTaskDefinition(
            self, "VoicebotTaskDef",
            memory_limit_mib=4096,
            cpu=1024,
        )

        # Nova Sonic 2 lives in us-east-1 — allow InvokeModel across all regions
        task_definition.add_to_task_role_policy(
            iam.PolicyStatement(
                actions=["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
                resources=[
                    "arn:aws:bedrock:*::foundation-model/*",
                    f"arn:aws:bedrock:*:{account}:inference-profile/*",
                ]
            )
        )

        # KB Retrieve + RetrieveAndGenerate in ap-south-1
        task_definition.add_to_task_role_policy(
            iam.PolicyStatement(
                actions=["bedrock:Retrieve", "bedrock:RetrieveAndGenerate"],
                resources=[f"arn:aws:bedrock:{kb_region}:{account}:knowledge-base/{kb_id}"]
            )
        )

        # CloudWatch logs
        log_group = logs.LogGroup(
            self, "VoicebotLogGroup",
            removal_policy=RemovalPolicy.DESTROY,
            retention=logs.RetentionDays.ONE_MONTH
        )
        task_definition.add_to_task_role_policy(
            iam.PolicyStatement(
                actions=["logs:CreateLogStream", "logs:PutLogEvents"],
                resources=[log_group.log_group_arn, f"{log_group.log_group_arn}:*"]
            )
        )

        # ── Container ─────────────────────────────────────────────────────
        container = task_definition.add_container(
            "VoicebotContainer",
            image=ecs.ContainerImage.from_asset("../backend", platform=Platform.LINUX_AMD64),
            memory_limit_mib=4096,
            cpu=1024,
            port_mappings=[ecs.PortMapping(container_port=3000)],
            environment={
                "AWS_REGION":              "us-east-1",   # Nova Sonic region
                "KB_REGION":               kb_region,
                "KB_KNOWLEDGE_BASE_ID":    kb_id,
                "KB_MODEL_ARN":            kb_model_arn,
                "PORT":                    "3000",
                "HOST":                    "0.0.0.0",
            },
            logging=ecs.LogDrivers.aws_logs(stream_prefix="voicebot", log_group=log_group)
        )

        # ── Security Groups ───────────────────────────────────────────────
        service_sg = ec2.SecurityGroup(
            self, "VoicebotServiceSG", vpc=vpc,
            description="Fargate service SG", allow_all_outbound=True
        )
        nlb_sg = ec2.SecurityGroup(
            self, "VoicebotNLBSG", vpc=vpc,
            description="NLB SG", allow_all_outbound=True
        )
        nlb_sg.add_ingress_rule(
            peer=ec2.Peer.any_ipv4(),
            connection=ec2.Port.tcp(80),
            description="Allow HTTP/WebSocket from internet"
        )
        service_sg.add_ingress_rule(
            peer=nlb_sg,
            connection=ec2.Port.tcp(3000),
            description="Allow traffic from NLB"
        )

        # ── Fargate Service ───────────────────────────────────────────────
        service = ecs.FargateService(
            self, "VoicebotService",
            cluster=cluster,
            task_definition=task_definition,
            desired_count=1,
            assign_public_ip=False,
            security_groups=[service_sg],
            vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS),
            min_healthy_percent=100,
            max_healthy_percent=200
        )

        # ── NLB ───────────────────────────────────────────────────────────
        nlb = elbv2.NetworkLoadBalancer(
            self, "VoicebotNLB",
            vpc=vpc,
            internet_facing=True,
            security_groups=[nlb_sg],
            vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PUBLIC)
        )
        listener = nlb.add_listener("HttpListener", port=80, protocol=elbv2.Protocol.TCP)
        listener.add_targets(
            "VoicebotTarget",
            port=3000,
            protocol=elbv2.Protocol.TCP,
            targets=[service.load_balancer_target(
                container_name="VoicebotContainer",
                container_port=3000
            )],
            health_check=elbv2.HealthCheck(
                enabled=True, port="3000",
                protocol=elbv2.Protocol.HTTP,
                path="/health"
            )
        )

        CfnOutput(self, "AppURL",
            value=f"http://{nlb.load_balancer_dns_name}",
            description="Voicebot URL (open in browser)"
        )
        CfnOutput(self, "WebSocketURL",
            value=f"ws://{nlb.load_balancer_dns_name}",
            description="WebSocket endpoint for Socket.io"
        )

        # ── CloudFront (HTTPS) ────────────────────────────────────────────
        nlb_origin = origins.HttpOrigin(
            nlb.load_balancer_dns_name,
            protocol_policy=cloudfront.OriginProtocolPolicy.HTTP_ONLY
        )
        websocket_policy = cloudfront.OriginRequestPolicy(
            self, "WSPolicy",
            origin_request_policy_name=f"WSPolicy-{Stack.of(self).stack_name}",
            header_behavior=cloudfront.OriginRequestHeaderBehavior.allow_list(
                "Sec-WebSocket-Key", "Sec-WebSocket-Version",
                "Sec-WebSocket-Protocol", "Sec-WebSocket-Accept"
            ),
            query_string_behavior=cloudfront.OriginRequestQueryStringBehavior.all(),
            cookie_behavior=cloudfront.OriginRequestCookieBehavior.all()
        )
        distribution = cloudfront.Distribution(
            self, "VoicebotDistribution",
            default_behavior=cloudfront.BehaviorOptions(
                origin=nlb_origin,
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
                allowed_methods=cloudfront.AllowedMethods.ALLOW_ALL,
                origin_request_policy=websocket_policy
            ),
            minimum_protocol_version=cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        )
        CfnOutput(self, "CloudFrontURL",
            value=f"https://{distribution.distribution_domain_name}",
            description="Voicebot HTTPS URL"
        )

        # ── CDK Nag suppressions ──────────────────────────────────────────
        cdk_nag.NagSuppressions.add_resource_suppressions(vpc, [
            {'id': 'AwsSolutions-VPC7', 'reason': 'VPC Flow Logs not required for demo.'}
        ])
        cdk_nag.NagSuppressions.add_resource_suppressions_by_path(self,
            f'/{self.stack_name}/VoicebotCluster/Resource',
            [{'id': 'AwsSolutions-ECS4', 'reason': 'Container insights not required for demo.'}]
        )
        cdk_nag.NagSuppressions.add_resource_suppressions_by_path(self,
            f'/{self.stack_name}/VoicebotTaskDef/Resource',
            [{'id': 'AwsSolutions-ECS2', 'reason': 'No secrets in plain-text env vars.'}]
        )
        cdk_nag.NagSuppressions.add_resource_suppressions_by_path(self,
            f'/{self.stack_name}/VoicebotTaskDef/TaskRole/DefaultPolicy/Resource',
            [{'id': 'AwsSolutions-IAM5', 'reason': 'Bedrock foundation-model/* wildcard required for model flexibility.'}]
        )
        cdk_nag.NagSuppressions.add_resource_suppressions_by_path(self,
            f'/{self.stack_name}/VoicebotTaskDef/ExecutionRole/DefaultPolicy/Resource',
            [{'id': 'AwsSolutions-IAM5', 'reason': 'CDK-generated ECR pull wildcards.'}]
        )
        cdk_nag.NagSuppressions.add_resource_suppressions_by_path(self,
            f'/{self.stack_name}/VoicebotNLB/Resource',
            [{'id': 'AwsSolutions-ELB2', 'reason': 'Access logging not required for demo.'}]
        )
        cdk_nag.NagSuppressions.add_resource_suppressions_by_path(self,
            f'/{self.stack_name}/VoicebotNLBSG/Resource',
            [{'id': 'AwsSolutions-EC23', 'reason': 'NLB open to internet for demo access.'}]
        )
