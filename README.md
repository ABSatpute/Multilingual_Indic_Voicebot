# Multilingual Indic Voicebot for Precise Engineers

[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Runtime-Node.js%20v22-green?style=flat-square&logo=nodedotjs)](https://nodejs.org/)
[![AWS CDK](https://img.shields.io/badge/IaC-AWS%20CDK%20(Python)-orange?style=flat-square&logo=amazonwebservices)](https://aws.amazon.com/cdk/)
[![Amazon Bedrock](https://img.shields.io/badge/AI%20Engine-Amazon%20Bedrock-red?style=flat-square&logo=amazonbedrock)](https://aws.amazon.com/bedrock/)
[![Sarvam AI](https://img.shields.io/badge/Speech%20API-Sarvam%20AI-purple?style=flat-square)](https://www.sarvam.ai/)
[![License](https://img.shields.io/badge/License-MIT--0-yellow?style=flat-square)](LICENSE)

A real-time, low-latency automated conversational sales agent for **Precise Engineers, Indore** (a pump, motor, cable, panel, and pipe distributor). 

Instead of being locked into a single persona, the assistant dynamically adapts its character profile based on the speaker voice selected by the user. It supports **12 languages** (English, Hindi, and 10 regional Indian languages) and offers **6 distinct speaker voices** (3 female: Priya, Neha, Kavya; and 3 male: Anand, Rahul, Shubh) powered by Sarvam AI.

The application leverages Amazon Bedrock for conversational dialogue generation, Bedrock Knowledge Base for RAG (Retrieval-Augmented Generation) product queries, and Sarvam AI for Speech-to-Text (STT) and Text-to-Speech (TTS) pipelines.

---

## Table of Contents
1. [Problem Statement](#problem-statement)
2. [Technical Architecture](#technical-architecture)
3. [Why This Infrastructure for AI Applications?](#why-this-infrastructure-for-ai-applications)
4. [Technical Stack](#technical-stack)
5. [Key Features](#key-features)
6. [Supported Languages](#supported-languages)
7. [Repository Structure & File Index](#repository-structure--file-index)
8. [Local Setup & Configuration](#local-setup--configuration)
   - [Prerequisites](#prerequisites)
   - [1. Set Up Environment Variables](#1-set-up-environment-variables)
   - [2. Local Installation & Run](#2-local-installation--run)
9. [AWS Deployment (IaC)](#aws-deployment-iac)
   - [1. Configure the CDK Virtual Environment](#1-configure-the-cdk-virtual-environment)
   - [2. Deploy Using AWS CDK](#2-deploy-using-aws-cdk)
   - [3. Tear Down (Stop AWS Charges)](#3-tear-down-stop-aws-charges)
10. [Maintenance & Operations](#maintenance--operations)
    - [How to Update the Sarvam API Key](#how-to-update-the-sarvam-api-key)
11. [Troubleshooting FAQ](#troubleshooting-faq)
12. [License](#license)

---

## Problem Statement

Traditional customer support systems and phone IVR menus for regional engineering equipment distributors face significant operational bottlenecks:

1. **The Multilingual Divide:** Regional distributors (such as **Precise Engineers**) serve diverse customer bases across multiple states—including rural farmers, agricultural technicians, and local contractors who communicate primarily in their regional native languages. Hiring and maintaining customer service personnel fluent in 10+ Indic languages is operationally complex and cost-prohibitive.
2. **Operational Overload from Repetitive Queries:** Up to 70% of inbound inquiries consist of repetitive requests for technical specifications (e.g., pump HP ratings, bore size compatibility, model prices) or basic complaint routing. Sales engineers are frequently distracted by routine triage instead of focusing on high-value business development.
3. **Frustrating Interaction Barriers:** Traditional IVR menus ("Press 1 for English...") suffer from high customer drop-off rates. Customers want to talk naturally, expect immediate answers without being placed on hold, and often code-switch (mix languages, like English and Hindi) during the same conversation.
4. **Lack of 24/7 Responsiveness:** Equipment failures and irrigation requirements often occur outside standard business hours. Lacking round-the-clock support directly leads to missed sales inquiries and delayed troubleshooting assistance.

This conversational AI voicebot solves these challenges by combining low-latency WebSockets, zero-shot Indic language auto-switching, dynamic speaker profiles, and automated Bedrock Knowledge Base RAG catalog querying into a single, scalable, and responsive cloud solution.

---

## Technical Architecture

```
                       [ Internet User ]
                               │
                               ▼ (HTTPS / Port 443)
                     ┌───────────────────┐
                     │  Amazon CloudFront│ (Terminates SSL)
                     └─────────┬─────────┘
                               │ (HTTP / Port 80)
                               ▼
                     ┌───────────────────┐
                     │    Network Load   │
                     │   Balancer (NLB)  │
                     └─────────┬─────────┘
                               │ (TCP / Port 3000)
                               ▼
        ┌─────────────────────────────────────────────────┐
        │                 AWS VPC (ap-south-1)            │
        │  ┌───────────────────────────────────────────┐  │
        │  │            Private Subnet                 │  │
        │  │   ┌───────────────────────────────────┐   │  │
        │  │   │        ECS Fargate Task           │   │  │
        │  │   │      (Node.js App Container)      │   │  │
        │  │   └───────────────┬───────────────────┘   │  │
        │  └───────────────────┼───────────────────────┘  │
        └──────────────────────┼──────────────────────────┘
                               │ (IAM Role - bedrock:InvokeModel)
                               ▼
                     [ Amazon Bedrock & KB ]
```

### Why This Infrastructure for AI Applications?

Designing low-latency voice AI assistants requires solving distinct networking and security challenges:

* **VPC & Private Subnets (IP & Data Security):** Because the backend container interacts with Bedrock models, contains API subscription keys, and runs RAG queries against the product catalog, it is isolated in a private subnet. The container has no public IP address, preventing direct scanner attacks and keeping customer queries and vector data secure.
* **Network Load Balancer (Layer 4 Routing):** Bidirectional real-time voice streaming relies on persistent WebSocket connections. Traditional Application Load Balancers (ALBs) operating at Layer 7 evaluate headers and add network routing latency. The NLB operates at Layer 4 (TCP level) to route audio packet buffers directly to the container instances with sub-millisecond routing overhead, ensuring no audio jitter or cutoff.
* **Amazon CloudFront (Edge Processing & SSL Offloading):** Offloads SSL/TLS decryption from the application container to the AWS edge. CloudFront handles HTTPS handshakes and dynamically maps both static elements and `/socket.io/*` WebSocket routes to the NLB, protecting the backend with built-in AWS Shield DDoS mitigation.
* **ECS Fargate (Dedicated Serverless Compute):** Real-time audio pipelines (handling concurrent STT, LLM streaming, and TTS synthesis) are CPU-bound. Fargate guarantees isolated vCPU and RAM parameters, preventing CPU starvation from distorting synthetic speech during voice generations.

---

## Technical Stack

| Layer | Technology |
|---|---|
| **Programming Languages** | TypeScript (Backend / Node.js v22), ES6 JavaScript (Client), Python (AWS CDK) |
| **Backend Framework** | Express + Socket.io (Low-latency WebSockets) |
| **Speech APIs** | **Sarvam AI** (`saaras:v3` for STT, `bulbul:v3` for TTS) |
| **LLM & RAG** | Amazon Bedrock (`nova-pro-v1:0` for LLM, `nova-micro-v1:0` for Knowledge Base queries) |
| **Client Frontend** | Vanilla HTML5 Canvas (Waveform rendering) + Web Audio API (PCM streaming) |
| **Infrastructure (IaC)** | AWS CDK (Python) |
| **Compute** | AWS ECS Fargate |
| **Networking** | AWS VPC, Network Load Balancer (NLB), Amazon CloudFront |

---

## Key Features

- **Language Auto-Switching:** Zero-shot language detection via Sarvam's `languageCode: "unknown"` parameter dynamically switches both the backend LLM synthesis and browser Speech Recognition to the user's spoken language locale.
- **Smart Barge-In Prevention:** Software-level acoustic feedback suppression, room noise floor tracking, and consecutive frame verification (4 frames / ~100ms) prevent accidental cutoffs from typing, background fan noise, or speaker echo.
- **RAG Knowledge Base integration:** The LLM triggers tool calls to search product catalogs stored dynamically in Amazon Bedrock Knowledge Base vector indexes.
- **Optional Custom Domain Mapping:** Built-in AWS CDK support to map custom domain names (e.g. `voicebot.preciseengineers.com`) through CloudFront and AWS Certificate Manager (ACM).

---

## Supported Languages

English · Hindi · Bengali · Tamil · Telugu · Kannada · Malayalam · Marathi · Gujarati · Odia · Punjabi · Assamese

---

## Repository Structure & File Index

Below is the complete file layout of the repository, explaining the role of each directory and configuration file:

```text
multilingual-indic-voicebot/
├── .env.example                # Template for configuring AWS credentials, Bedrock IDs, and Sarvam API key.
├── .gitignore                  # Git exclusion rules for node_modules, .venv, CDK output directories, and local secrets.
├── README.md                   # Main documentation guide (setup, configuration, operations, and technical stack).
│
├── backend/                    # TypeScript backend server and static frontend assets.
│   ├── Dockerfile              # Multi-stage Docker build config optimizing container size for production.
│   ├── .dockerignore           # Specifies folders/files to exclude from ECR container builds.
│   ├── package.json            # Node.js project manifest listing dependency libraries and build/start scripts.
│   ├── tsconfig.json           # Compiler options mapping TypeScript code to target JavaScript standard.
│   ├── server.ts               # Core web server (Express); initializes Socket.io WebSockets and serves public assets.
│   ├── SarvamPipeline.ts       # Orchestrator managing audio streams, language detection, tool calls, and LLM conversations.
│   │
│   ├── public/                 # Static web client served by the Express server.
│   │   ├── index.html          # Main HTML structure, layout elements, and visual containers for the voicebot UI.
│   │   ├── nova-icon.png       # Branding/favicon asset for the web interface.
│   │   │
│   │   ├── prompts/
│   │   │   └── default.md      # Persona prompt instructions for the RAG agent (personality, parameters, boundaries).
│   │   │
│   │   └── src/                # Front-end JavaScript, CSS modules, and sub-components.
│   │       ├── main.js         # Client orchestrator: binds WebSockets, downsamples audio, tracks VAD noise floors.
│   │       ├── typing.js       # Renders streaming transcription text logs with typing indicators.
│   │       ├── style.css       # Premium custom styling (glassmorphism UI layout, animations, responsive design).
│   │       │
│   │       ├── ui/
│   │       │   ├── SettingsPanel.js    # Manages settings sidebar events, inputs, defaults, and resets.
│   │       │   └── WaveformRenderer.js # Visualizes real-time audio amplitudes using dual-overlay HTML5 canvas waves.
│   │       │
│   │       └── lib/            # Internal modules handling audio capture, processing, playback, and timing utilities.
│   │
│   └── types/                  # Internal TypeScript custom interface definitions.
│
├── docs/                       # Project blueprints and deployment artifacts.
│   └── PROJECT_DOCUMENTATION.md # Comprehensive engineering reference detailing architecture, VAD formulas, and data flows.
│
└── infra/                      # Infrastructure as Code (IaC) powered by AWS CDK.
    ├── app.py                  # CDK application entry point; loads root .env and instantiates the deployment stack.
    ├── cdk.json                # CDK configuration detailing contexts, feature flags, and compiler mappings.
    ├── requirements.txt        # Python package dependency list for AWS CDK operations.
    ├── infra_stack.py          # Provisions AWS resources (VPC, ECS cluster, task definitions, NLB, CloudFront).
    └── vpc_construct.py        # Configures Custom VPC networks with subnets and ingress/egress controls.
```

---

## Local Setup & Configuration

### Prerequisites
* **Runtime Environments:** Node.js (v22+), Python (3.12+).
* **Developer Tools:** Docker Desktop (or engine), AWS CLI v2 (configured with Administrator credentials).
* **External APIs:** Active **Sarvam AI** Subscription Key (created at dashboard.sarvam.ai).

### 1. Set Up Environment Variables
Create a `.env` file in **both** the project's root folder and the `backend/` folder. Use the following template reference:

| Environment Variable | Description | Example / Value | Required |
| :--- | :--- | :--- | :---: |
| `AWS_ACCOUNT_ID` | Your 12-digit AWS Account ID for role bindings. | `123456789012` | **Yes** |
| `AWS_DEFAULT_REGION` | AWS Region for VPC and NLB resources. | `ap-south-1` | **Yes** |
| `KB_REGION` | AWS Region where Bedrock KB & Model are enabled. | `ap-south-1` | No |
| `KB_KNOWLEDGE_BASE_ID`| The ID of the indexed Bedrock Knowledge Base. | `HN2QJNTWYX` | **Yes** |
| `KB_MODEL_ARN` | ARN of Bedrock target model (e.g. Nova Micro). | `arn:aws:bedrock:...` | **Yes** |
| `LLM_MODEL` | Main conversational model for dialogue. | `apac.amazon.nova-pro-v1:0`| No |
| `SARVAM_API_KEY` | Subscription API key from Sarvam Dashboard. | `sk_your_key_here` | **Yes** |
| `SARVAM_STT_MODEL` | Transcription model identifier. | `saaras:v3` | No |
| `SARVAM_TTS_MODEL` | Speech synthesis model identifier. | `bulbul:v3` | No |
| `PORT` | Local server execution port. | `3000` | No |
| `HOST` | Network binding host address. | `0.0.0.0` | No |
| `ALLOWED_ORIGINS` | Allowed CORS request domains. | `*` | No |
| `CUSTOM_DOMAIN_NAME` | Mapped custom domain (leave blank to skip). | `voicebot.yourdomain.com`| No |
| `ACM_CERTIFICATE_ARN`| ACM Certificate ARN (must reside in `us-east-1`). | `arn:aws:acm:us-east-1:...`| No |

### 2. Local Installation & Run
From the root directory:

```bash
# 1. Install and compile backend TypeScript
cd backend
npm install
npm run build

# 2. Start the local server
npm start
```
Open `http://localhost:3000` in your web browser.

---

## AWS Deployment (IaC)

### 1. Configure the CDK Virtual Environment
Navigate to the `infra/` folder and configure python dependencies:
```bash
cd infra
python -m venv .venv

# Activate Virtual Env (Windows):
.venv\Scripts\Activate.ps1
# Activate Virtual Env (Mac/Linux):
source .venv/bin/activate

pip install -r requirements.txt
```

### 2. Deploy Using AWS CDK
While in the `infra/` directory (with virtual env active):
```bash
# Bootstrap CDK (if first time in target region)
npx cdk bootstrap --profile <your-aws-profile>

# Synthesize template
npx cdk synth

# Deploy stack
npx cdk deploy --require-approval never --profile <your-aws-profile>
```

### 3. Tear Down (Stop AWS Charges)
To delete all compute resources and network setups:
```bash
npx cdk destroy --profile <your-aws-profile>
```

---

## Maintenance & Operations

### How to Update the Sarvam API Key
If your Sarvam API Key expires and you need to deploy a new one:
1. Update the `SARVAM_API_KEY` value in your root `.env` file.
2. Open your terminal in the `infra/` folder, activate the virtual environment, and run:
   ```bash
   npx cdk deploy --require-approval never --profile <your-aws-profile>
   ```
ECS Fargate will trigger a zero-downtime rolling deployment, spinning up a new task with the updated key, verifying its health on `/health`, and terminating the old task.

---

## Troubleshooting FAQ

### Q1: Voice processing fails or cuts off immediately with a "402 Payment Required" error.
* **Cause:** Your Sarvam API subscription has run out of credits, or the API key is invalid/expired.
* **Solution:** Create or fund your key on the [Sarvam AI Dashboard](https://dashboard.sarvam.ai), update the `SARVAM_API_KEY` in your root `.env`, and redeploy using `npx cdk deploy`.

### Q2: The client browser console prints continuous WebSocket connection retries.
* **Cause:** The Network Load Balancer (NLB) target groups are listing the ECS containers as `Unhealthy`, or the CloudFront edge proxy is not forwarding raw Socket.io headers.
* **Solution:** Check your container health in the ECS Console. Verify that the task starts and binds to port `3000` correctly. Ensure the NLB target group path is set to `/health`.

### Q3: The bot replies but fails to fetch product catalog pricing or pump details.
* **Cause:** The Bedrock Knowledge Base vector store is out-of-sync with the S3 data bucket, or permissions on the Task Role are insufficient.
* **Solution:** Log in to the AWS console, navigate to **Amazon Bedrock -> Knowledge Bases -> [Your KB ID]**, and click **Sync** to re-index the catalog file. Verify `infra_stack.py` grants permissions for `bedrock:Retrieve` and `bedrock:RetrieveAndGenerate`.

---

## License

This project is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file for details.
