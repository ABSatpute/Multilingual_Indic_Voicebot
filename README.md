# Multilingual Indic Voicebot for Precise Engineers

A real-time, low-latency automated conversational agent designed to act as **Riya**, the senior inbound sales executive for **Precise Engineers, Indore** (a pump, motor, cable, panel, and pipe distributor). 

This application supports English, Hindi, and 10 regional Indian languages. It uses Amazon Bedrock for dialogue generation, Bedrock Knowledge Base for RAG (Retrieval-Augmented Generation) product queries, and Sarvam AI for Speech-to-Text (STT) and Text-to-Speech (TTS).

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

### How to Map a Custom Domain
To assign a custom domain mapping to the voicebot:
1. Request a public ACM SSL certificate inside the **`us-east-1` (N. Virginia)** region for your target domain (e.g. `voicebot.preciseengineers.com`).
2. Add your DNS validation CNAME records to verify domain ownership.
3. Once the certificate is **Issued**, copy its ARN.
4. Update the root `.env` with:
   - `CUSTOM_DOMAIN_NAME=voicebot.preciseengineers.com`
   - `ACM_CERTIFICATE_ARN=arn:aws:acm:us-east-1:<YOUR_AWS_ACCOUNT_ID>:certificate/<CERTIFICATE_ID>`
5. Run `npx cdk deploy` to update the CloudFront distribution.
6. Create an Alias (A) or CNAME record in your DNS provider pointing your domain to the output CloudFront domain name (e.g. `<YOUR_DISTRIBUTION_ID>.cloudfront.net`).

---

## License

This project is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file for details.
