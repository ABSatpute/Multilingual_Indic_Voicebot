# Multilingual Indic Voicebot for Precise Engineers

A real-time, low-latency automated conversational sales agent for **Precise Engineers, Indore** (a pump, motor, cable, panel, and pipe distributor). 

Instead of being locked into a single persona, the assistant dynamically adapts its character profile based on the speaker voice selected by the user. It supports **12 languages** (English, Hindi, and 10 regional Indian languages: Bengali, Tamil, Telugu, Kannada, Malayalam, Marathi, Gujarati, Odia, Punjabi, and Assamese) and offers **6 distinct speaker voices** (3 female: Priya, Neha, Kavya; and 3 male: Anand, Rahul, Shubh) powered by Sarvam AI.

---

## Problem Statement

Traditional customer support systems and phone IVR menus for regional engineering distributors face significant operational bottlenecks:

1. **The Multilingual Divide:** Regional distributors (such as **Precise Engineers**) serve diverse customer bases across multiple states—including rural farmers, agricultural technicians, and municipal contractors who communicate primarily in their regional native languages. Hiring and maintaining customer service personnel fluent in 10+ Indic languages is operationally complex and cost-prohibitive.
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

- **VPC & Private Subnets (IP & Data Security):** Because the backend container interacts with Bedrock models, contains API subscription keys, and runs RAG queries against the product catalog, it is isolated in a private subnet. The container has no public IP address, preventing direct scanner attacks and keeping customer queries and vector data secure.
- **Network Load Balancer (Layer 4 Routing):** Bidirectional real-time voice streaming relies on persistent WebSocket connections. Traditional Application Load Balancers (ALBs) operating at Layer 7 evaluate headers and add network routing latency. The NLB operates at Layer 4 (TCP level) to route audio packet buffers directly to the container instances with sub-millisecond routing overhead, ensuring no audio jitter or cutoff.
- **Amazon CloudFront (Edge Processing & SSL Offloading):** Offloads SSL/TLS decryption from the application container to the AWS edge. CloudFront handles HTTPS handshakes and dynamically maps both static elements and `/socket.io/*` WebSocket routes to the NLB, protecting the backend with built-in AWS Shield DDoS mitigation.
- **ECS Fargate (Dedicated Serverless Compute):** Real-time audio pipelines (handling concurrent STT, LLM streaming, and TTS synthesis) are CPU-bound. Fargate guarantees isolated vCPU and RAM parameters, preventing CPU starvation from distorting synthetic speech during voice generations.

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

## Features

- **ChatGPT-Style Language Auto-Switching:** Zero-shot language detection via Sarvam's `languageCode: "unknown"` parameter dynamically switches both the backend LLM synthesis and browser Speech Recognition to the user's spoken language locale.
- **Smart Barge-In Prevention:** Software-level acoustic feedback suppression, room noise floor tracking, and consecutive frame verification (4 frames / ~100ms) prevent accidental cutoffs from typing, background fan noise, or speaker echo.
- **RAG Knowledge Base integration:** The LLM triggers tool calls to search product catalogs stored dynamically in Amazon Bedrock Knowledge Base vector indexes.
- **Optional Custom Domain Mapping:** Built-in AWS CDK support to map custom domain names (e.g. `voicebot.preciseengineers.com`) through CloudFront and AWS Certificate Manager (ACM).

---

## Supported Languages

English · Hindi · Bengali · Tamil · Telugu · Kannada · Malayalam · Marathi · Gujarati · Odia · Punjabi · Assamese

---

## Project Structure & File Index

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
- AWS Account with admin IAM credentials.
- Python 3.12+ and virtual environments.
- Node.js 22+.
- Docker Desktop.
- Active **Sarvam AI** API Subscription Key.

### 1. Set Up Environment Variables
Create a `.env` file in **both** the project's root folder and the `backend/` folder. Use the following template:

```env
# AWS Credentials & Connection Settings
AWS_ACCOUNT_ID=<YOUR_AWS_ACCOUNT_ID>
AWS_DEFAULT_REGION=ap-south-1

# Bedrock Knowledge Base Configuration
KB_REGION=ap-south-1
KB_KNOWLEDGE_BASE_ID=<YOUR_BEDROCK_KNOWLEDGE_BASE_ID>
KB_MODEL_ARN=arn:aws:bedrock:ap-south-1:<YOUR_AWS_ACCOUNT_ID>:inference-profile/apac.amazon.nova-micro-v1:0
LLM_MODEL=apac.amazon.nova-pro-v1:0

# Sarvam AI API Configurations
SARVAM_API_KEY=<YOUR_SARVAM_API_KEY>
SARVAM_STT_MODEL=saaras:v3
SARVAM_TTS_MODEL=bulbul:v3

# Server Setup
PORT=3000
HOST=0.0.0.0
ALLOWED_ORIGINS=*

# Custom Domain (Optional - Leave blank to use default *.cloudfront.net)
CUSTOM_DOMAIN_NAME=
ACM_CERTIFICATE_ARN=
```

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
# Bootstrap CDK (if first time in region)
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
ECS will trigger a zero-downtime rolling deployment, launching a new task with the updated key and shutting down the old one.


## License

This project is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file for details.
