#!/usr/bin/env python3

# Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import os
from aws_cdk import App, Environment, Aspects
from cdk_nag import AwsSolutionsChecks

from infra_stack import InfraStack

# Helper to load central .env from root
def load_env_file(file_path):
    env_vars = {}
    if os.path.exists(file_path):
        with open(file_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, val = line.split("=", 1)
                    env_vars[key.strip()] = val.strip().strip('"').strip("'")
    return env_vars

# Load the central root .env file and merge with environment
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
root_env_path = os.path.join(root_dir, '.env')
env_config = load_env_file(root_env_path)

for k, v in env_config.items():
    if k not in os.environ:
        os.environ[k] = v

app = App()
Aspects.of(app).add(AwsSolutionsChecks(verbose=True))

account = os.environ.get('AWS_ACCOUNT_ID') or os.getenv('CDK_DEFAULT_ACCOUNT')
region = os.environ.get('AWS_DEFAULT_REGION') or os.getenv('CDK_DEFAULT_REGION') or 'ap-south-1'

env = Environment(
    account=account,
    region=region
)
InfraStack(app, "VoicebotStack", 
    description="Voicebot with speech to speech as well as STT-LLM-TTS pipelines (uksb-qon0ui1aa6).",
    env=env, termination_protection=False)

app.synth()
