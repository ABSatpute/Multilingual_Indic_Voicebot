# KNOWLEDGE TRANSFER (KT) & HANDOVER DOCUMENTATION
## Project: Multilingual Indic Voicebot for Precise Engineers

This document serves as the official Knowledge Transfer (KT) and systems handover manual for the **Multilingual Indic Voicebot** developed for **Precise Engineers, Indore**. It is designed to onboard developers, systems engineers, and maintainers by providing granular-level details on the architecture, technical stack, environment variables, APIs, cloud infrastructure, and operational workflows.

---

## 1. DOCUMENT CONTROL
* **Version:** 1.0.0
* **Status:** Deployed / Production-Ready
* **Author:** Lead AI Developer / Antigravity Coding Assistant
* **Target Audience:** Engineering Team, DevOps, Inbound Sales Administrators
* **Repository:** [ABSatpute/multilingual-indic-voicebot](https://github.com/ABSatpute/multilingual-indic-voicebot)
* **Production App HTTPS URL:** [https://d15t57ygc4emfz.cloudfront.net](https://d15t57ygc4emfz.cloudfront.net)

---

## 2. PROJECT SUMMARY & BUSINESS VALUE
The voicebot is a real-time, low-latency automated conversational agent designed to act as **Riya**, the senior inbound sales executive for **Precise Engineers, Indore** (a pump, motor, cable, panel, and pipe distributor). 

### Key Business Goals:
1. **Automate Triage:** Filter incoming customer requests into "New Product Sales Inquiries" or "Complaints/Service Requests" (redirections go directly to support head Bikram Ji).
2. **Product Catalog Queries:** Connect customers directly to Precise Engineers' catalog via RAG, answering queries about models, HP ratings, bore size compatibility, and phase requirements without human intervention.
3. **Ind indic-Language Accessibility:** Offer seamless sales conversations in 12 regional languages to cater to rural farmers, local contractors, and municipal distributors across India.

---

## 3. GRANULAR TECHNOLOGIES & SERVICES REFERENCE

The system is constructed with strict modularity, dividing concerns between Client, Server, speech APIs, LLM, and cloud layers. Below is the comprehensive directory of all components.

### A. Core Runtime & Programming Languages
| Technology | Version | Purpose in Project |
| :--- | :--- | :--- |
| **Node.js** | `v22-slim` | Execution runtime for the backend API and WebSocket orchestrator. The `slim` image minimizes production container overhead. |
| **TypeScript** | `v5.x` | Used throughout the backend to provide type safety, modular structures, and compile-time verification. |
| **Vanilla JavaScript** | ES6+ | Client-side scripting inside `main.js` to manage browser audio buffers and UI styling without heavy framework overhead. |
| **Python** | `v3.12` | Python environment for running the AWS Cloud Development Kit (CDK) app and provisioning infrastructure. |

### B. Libraries, Frameworks & Protocols
| Dependency / Protocol | Version / Config | Purpose in Project |
| :--- | :--- | :--- |
| **Express** | `^4.x` | Micro-web framework in `backend/server.ts` mapped to static files `/public` and a health check endpoint `/health`. |
| **Socket.IO** | `^4.x` | Enables real-time, bidirectional, low-latency communication via WebSockets (`wss://`). Essential for streaming raw binary audio blocks. |
| **Web Audio API** | Native Browser | Operates on the client to request mic permissions, access the microphone stream, convert floats into signed 16-bit PCM buffers, and play raw streaming audio. |
| **Web Speech API** | Native Browser | Backs up translation visualization. Restarts with the correct locale settings upon `languageDetected` events to sync client-side input with backend pipeline languages. |

### C. Speech & Language APIs (Sarvam AI)
All voice interactions are routed to **Sarvam AI** endpoints using the API Subscription Key (`api-subscription-key`).
* **Speech-to-Text (STT) Service:**
  * **Model:** `saaras:v3`
  * **Endpoint:** `POST https://api.sarvam.ai/speech-to-text`
  * **Key Parameter:** `languageCode: 'unknown'`. This activates Sarvam's zero-shot language classifier, enabling automatic detection of the spoken Indic language.
  * **Output Payload:** Returns `transcript` (text) and `stt.language_code` (e.g., `hi-IN`, `mr-IN`, `ta-IN`).
* **Text-to-Speech (TTS) Service:**
  * **Model:** `bulbul:v3`
  * **Endpoint:** `POST https://api.sarvam.ai/text-to-speech`
  * **Voice / Speaker:** `anand` (for male profile) or `priya` (for female profile).
  * **Audio Format:** `pcm` at `16000Hz` sample rate.
  * **Key Parameter:** `target_language_code` is dynamically set to match the conversation's active language, ensuring text characters are synthesized using the correct phonetic voice engine.

### D. LLM & Retrieval-Augmented Generation (RAG)
* **Amazon Bedrock Converse API (`nova-pro-v1:0`):**
  * The main conversational agent. Nova Pro acts as the brain, holding dialogue state, maintaining persona boundaries, and translating outputs.
  * **Language Switch Tags:** The LLM is strictly instructed via system prompt to prepend its replies with language bracket tags (e.g., `[hi-IN]`, `[mr-IN]`, `[te-IN]`). The backend intercepts these, strips the brackets for the TTS synthesizer, and emits the language locale update to the browser.
* **Bedrock Knowledge Base (`RetrieveAndGenerate`):**
  * **Region:** `ap-south-1`
  * **Knowledge Base ID:** `HN2QJNTWYX`
  * **Model ARN:** `arn:aws:bedrock:ap-south-1:417780655467:inference-profile/apac.amazon.nova-micro-v1:0`
  * **Data Source:** Catalog files stored in S3, indexed with semantic search.
  * **Execution:** Triggered via the `search_knowledge_base` tool definition. The LLM invokes this tool silently when asked technical specifications, and reads the returned details directly from the vector store context.

---

## 4. DETAILED DATA FLOW & PIPELINE DETAILS

The conversation flow operates in a highly-optimized WebSocket event loop:

### Step 1: Client Audio Acquisition & VAD processing
* The browser accesses the user's microphone (`navigator.mediaDevices.getUserMedia`).
* An `AudioContext` downsamples input from the browser's default (44.1kHz or 48kHz) to **16kHz**.
* `onaudioprocess` reads the raw float audio buffers and converts them to **16-bit Signed Linear PCM** (`Int16Array`).
* The PCM buffer is converted to a base64 string and emitted to the server via Socket.IO:
  ```javascript
  socket.emit('audioInput', base64Data);
  ```

### Step 2: Adaptive Client-Side Voice Activity Detection (VAD)
To ensure clean conversational turns, the client monitors volume Levels (Root Mean Square / RMS) under the following conditions:
* **Noise Floor Tracking:** When both user and bot are silent, the client tracks ambient room noise (such as fans, keyboard typing, clicks):
  $$\text{NoiseFloor} = \text{NoiseFloor} \times 0.98 + \text{RMS} \times 0.02$$
* **Sustained Speech Verification:** A volume spike is only registered as speech if the mic RMS stays above the active threshold for **at least 4 consecutive frames** (~50-120ms), filtering out sudden mouse clicks or key presses.
* **Echo Feedback Suppression (Software-Level AEC):** While the bot is speaking, the barge-in threshold is raised:
  $$\text{ActiveBargeInThreshold} = \max(\text{ConfigThreshold} \times 1.6, \text{NoiseFloor} \times 2.2)$$
  This prevents the audio playing out of the speakers from triggering a false user speech detection.

### Step 3: Turn End & Server Orchestration
* When the client VAD detects silence for more than a configured timing (e.g. `1200ms`), the client:
  1. Calls `stopSpeechRecognition()` (stops backup web speech).
  2. Emits `socket.emit('sarvamAudioEnd')`.
* The server collects the accumulated PCM buffers from `SarvamPipeline.ts` and posts them to the Sarvam STT API.
* The API returns the transcription and the detected language code (e.g., `te-IN`).
* If the language changed:
  * The server emits `socket.emit('languageDetected', { languageCode: 'te-IN' })`.
  * The client updates its dropdown selection and restarts browser SpeechRecognition under `te-IN`.

### Step 4: AI Context Synthesis & Text-To-Speech (TTS)
* The transcript is pushed to the Amazon Bedrock Converse API.
* If a product catalog search is required, Bedrock triggers the `search_knowledge_base` tool, which queries the vector database (`RetrieveAndGenerate`).
* Bedrock returns the final conversational response text (with a prepended language tag).
* The server parses and removes the language tag, updates its internal TTS model language code, and calls the Sarvam TTS API.
* Sarvam TTS returns raw PCM audio chunks, which the server immediately relays to the client:
  ```typescript
  socket.emit('audioOutput', pcmAudioChunk);
  ```
* The client decodes the PCM chunks on the fly using Web Audio API nodes for immediate low-latency playback.

---

## 5. LOCAL DEVELOPER ONBOARDING & RUNNING GUIDE

### A. System Prerequisites
* **Runtime Environments:** Node.js (v20+), Python (v3.11+).
* **Package Managers:** NPM (v10+), Python `pip` and virtual environments.
* **Infrastructure Deployments:** AWS CLI v2 (configured with IAM credentials), Docker Desktop.

### B. Repository Structure & Dependency Installation
From the root of the project:

1. **Install Root and Backend Dependencies:**
   ```bash
   # Go to backend folder
   cd backend
   npm install
   ```
2. **Install Infrastructure (IaC) Python Dependencies:**
   ```bash
   cd ../infra
   python -m venv .venv
   # Windows Activation:
   .venv\Scripts\Activate.ps1
   # macOS/Linux Activation:
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

### C. Local Configurations
Create `.env` files in both the **root** folder and **backend/** folder. Use the following template:

```env
# AWS Credentials and Region
AWS_ACCOUNT_ID=417780655467
AWS_DEFAULT_REGION=ap-south-1
KB_REGION=ap-south-1

# Amazon Bedrock Knowledge Base and Models
KB_KNOWLEDGE_BASE_ID=HN2QJNTWYX
KB_MODEL_ARN=arn:aws:bedrock:ap-south-1:417780655467:inference-profile/apac.amazon.nova-micro-v1:0
LLM_MODEL=apac.amazon.nova-pro-v1:0

# Sarvam AI API Configurations
SARVAM_API_KEY=sk_cr6sjh1a_xzmMeGLkyWFoO91eCezihBn9
SARVAM_STT_MODEL=saaras:v3
SARVAM_TTS_MODEL=bulbul:v3

# Network Port
PORT=3000
HOST=0.0.0.0
ALLOWED_ORIGINS=*
```

### D. Running Local Development Server
1. Compile and build the backend typescript:
   ```bash
   cd backend
   npm run build
   ```
2. Start the local server:
   ```bash
   npm start
   ```
3. Open `http://localhost:3000` in your web browser.

---

## 6. CLOUD INFRASTRUCTURE & IAC REFERENCE (AWS CDK)

All infrastructure is provisioned programmatically in ap-south-1 via the Python CDK stack (`infra/infra_stack.py`).

```
                              [ Internet User ]
                                      │
                                      ▼  (HTTPS / Port 443)
                            ┌───────────────────┐
                            │  Amazon CloudFront│ (Terminates SSL)
                            └─────────┬─────────┘
                                      │  (HTTP / Port 80)
                                      ▼
                            ┌───────────────────┐
                            │    Network Load   │
                            │   Balancer (NLB)  │
                            └─────────┬─────────┘
                                      │  (TCP / Port 3000)
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

### A. AWS Network Topology
* **VPC:** 1 Availability Zone (AZ) configuration containing:
  * **Public Subnet:** Houses the Internet-facing Load Balancer and NAT Gateway.
  * **Private Subnet:** Houses the ECS Fargate container instances, protecting them from direct Internet ingress.
* **Network Load Balancer (NLB):** Operates at Layer 4. Configured with a TCP listener on Port 80 that targets Container Port 3000. It preserves raw, sticky TCP WebSocket sessions.
* **Amazon CloudFront (CDN):** Serves as the HTTPS edge proxy. It terminates SSL/TLS certificates and forwards paths:
  * Static web client calls are forwarded directly.
  * `/socket.io/*` paths are forwarded directly to the NLB with cache disabled, and headers `Sec-WebSocket-Key`, `Sec-WebSocket-Version`, `Sec-WebSocket-Protocol`, and `Sec-WebSocket-Accept` preserved to allow HTTP -> WebSocket upgrades.

### B. AWS ECS Fargate Tasks
* **CPU:** 1024 (1 vCPU)
* **RAM:** 4096 (4 GB)
* **Docker Multi-Stage Build:**
  * Uses `node:22-slim` to execute compiles and copy the final output directory `/dist` and public folders `/public` into the output runtime target.
* **IAM Least-Privilege Policies:**
  * `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` on foundation models and inference profiles.
  * `bedrock:Retrieve` and `bedrock:RetrieveAndGenerate` on the Knowledge Base ARN `arn:aws:bedrock:ap-south-1:417780655467:knowledge-base/HN2QJNTWYX`.
  * `logs:CreateLogStream` and `logs:PutLogEvents` for Amazon CloudWatch output logs.

---

## 7. MAINTENANCE & TROUBLESHOOTING HANDOVER

### A. Deployment Command
To redeploy the backend application after making local edits:
1. Ensure AWS credentials are configuration-active.
2. In the `infra/` folder, run the CDK deploy command:
   ```bash
   powershell -NoProfile -Command ". .venv\Scripts\Activate.ps1; npx cdk deploy --require-approval never"
   ```

### B. System Health Verification
* **Endpoint:** `GET https://d15t57ygc4emfz.cloudfront.net/health`
* **Expected Output:**
  ```json
  {
    "status": "ok",
    "timestamp": "2026-05-31T07:11:47.000Z",
    "activeSessions": 0,
    "socketConnections": 0
  }
  ```

### C. Troubleshooting Common Production Failures
1. **Quota / Credit Failures (`Status code: 402`):**
   * **Symptom:** Voice recording fails immediately. Console logs display `insufficient_quota_error` or `No credits available`.
   * **Fix:** Access the [Sarvam Dashboard](https://dashboard.sarvam.ai), add billing credits to your key, or swap out the `SARVAM_API_KEY` configuration in the `.env` files and AWS Secrets Manager. Run a redeployment.
2. **WebSocket Connection Failures (Web Console Connection Dropped):**
   * **Symptom:** Avatar sits idle, console displays connection retry warnings.
   * **Fix:** Confirm CloudFront origin request policies are preserving WebSocket headers. Ensure NLB target group health checks on `/health` (Port 3000) are reporting targets as `Healthy`.
3. **LLM Silent Tool Call Failures (Missing Specs in Response):**
   * **Symptom:** Bot says *"Iske baare mein main ek baar team se confirm karke..."* on simple catalogue queries.
   * **Fix:** The Bedrock Knowledge Base vector store requires syncing. Go to the AWS Bedrock Console -> Knowledge Bases -> Select `HN2QJNTWYX` -> Click **Sync** to re-index files from the S3 bucket.
