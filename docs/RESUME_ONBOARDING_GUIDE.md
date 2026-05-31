# AI Voicebot Project: Resume & Technical Interview Guide

This guide is designed to translate the **Multilingual Indic Voicebot** project into professional, high-impact resume bullet points (optimized for Applicant Tracking Systems) and prepare you for technical interview discussions.

---

## 1. Project Perspective (The Engineering Architecture)

### Core Project Value:
A low-latency, real-time automated voice sales agent engineered to consult customers, search catalog specifications using RAG (Retrieval-Augmented Generation), and handle conversations across **12 Indic languages** with **6 distinct voice profiles**.

### Key Architectural Challenges & Solutions:
1. **Turn-Taking Latency:** Normal REST APIs introduce a 4–5 second lag. We solved this by using **Socket.io WebSockets** to stream raw 16-bit Signed Linear PCM audio bidirectionally, reducing turn-taking latency to **under 1.8 seconds**.
2. **Acoustic Echo and Room Noise:** Traditional microphone capture often causes the bot to interrupt itself. We implemented an **adaptive client-side digital signal processing (DSP)** system in JavaScript that calculates a running noise floor and scales up the barge-in threshold dynamically when the bot is speaking (feedback cancellation).
3. **Cross-Region LLM Routing:** Bedrock Nova Sonic 2 is currently available in `us-east-1`, while the RAG Knowledge Base resides in `ap-south-1`. We engineered a cross-region loop using the AWS SDK, retrieving vector contexts from Mumbai and feeding them to the conversational model in N. Virginia.
4. **Dynamic Language Switch:** We used Sarvam's zero-shot classification (`languageCode: "unknown"`) to detect user language at turn-ends. If a change occurs, the server signals the client via WebSocket to restart browser recognition in the new locale, ensuring text visualizers stay synchronized.

---

## 2. Experience Perspective (ATS-Friendly Resume Bullet Points)

Select the bullet points that best align with the specific job description you are targeting:

### A. For Data Scientist & Machine Learning Engineer Roles
* **Low-Latency Speech Pipelines:** Architected and deployed a speech-to-speech conversational AI system utilizing **Amazon Bedrock (Nova Pro)** and **Sarvam AI APIs**, reducing round-trip voice latency to **under 1.8 seconds** via persistent WebSockets.
* **Signal Processing (DSP):** Developed a client-side digital signal processing (DSP) system in vanilla JS that tracks ambient room noise floors and applies echo suppression, filtering out **95%+ of microphone clicks and speaker loopbacks**.
* **Zero-Shot Localization:** Engineered a dynamic Indic language auto-switching pipeline supporting **12 languages** (Hindi, Bengali, Tamil, etc.) and **6 distinct speaker profiles** by leveraging zero-shot language classifiers to swap translation locales on-the-fly.
* **Conversation Flow Optimization:** Implemented LLM formatting rules and prompt engineering schemas to force bracketed ISO language tags, enabling the server to automatically extract tags, strip syntax, and route synthesized text to matching voice engines.

### B. For Generative AI & LLM Application Developer Roles
* **Context-Aware RAG Agent:** Engineered a Retrieval-Augmented Generation (RAG) agent using **Amazon Bedrock Agent Runtime** and a vector search index to automate technical catalog queries with high contextual accuracy.
* **Declarative Tool Calling:** Configured and managed JSON schema declarations to enable Bedrock to conditionally pause text synthesis and invoke custom search tools, injecting retrieved vector text chunks back into LLM memory.
* **Reasoning Loop Implementation:** Structured a multi-step reasoning recursion loop in TypeScript (max 5 iterations) to handle complex, multi-turn vector searches, emitting real-time tool state notifications (`toolUse`, `toolResult`) to synchronize client visual logs.
* **System Prompt Design:** Authored and tuned a markdown-formatted system prompt containing persona rules, domain boundaries, guardrails, and greeting templates in all 11 Indic scripts.

### C. For Cloud & DevOps (Infrastructure as Code) Roles
* **Infrastructure as Code (IaC):** Provisioned the entire AWS network and compute stack using **AWS CDK (Python)**, facilitating reproducible deployments and automated environment configurations.
* **Serverless Container Compute:** Containerized the Node.js TypeScript application using multi-stage Docker builds and deployed it on **AWS ECS Fargate** with dedicated resource allocations (1 vCPU / 4 GB RAM) for scalable compute isolation.
* **Low-Latency Routing:** Set up an internet-facing **Network Load Balancer (NLB)** operating at Layer 4 (TCP) to maintain persistent, sticky WebSocket connections to the ECS private subnet tasks.
* **Edge Proxy & Security:** Configured **Amazon CloudFront** as an edge routing CDN, terminating SSL/TLS certificates at AWS edge locations and applying cache policies to securely upgrade HTTP requests to WebSocket connections.

---

## 3. Interview Cheat Sheet (Q&A Preparation)

Be prepared to answer these technical questions during your engineering interview:

### Q1: Why did you choose a Network Load Balancer (NLB) instead of an Application Load Balancer (ALB)?
> **Answer:** "An ALB operates at Layer 7 (HTTP level). When dealing with persistent WebSockets, ALBs evaluate headers and can introduce additional latency and connection drops due to idle timeouts. A Network Load Balancer (NLB) operates at Layer 4 (TCP level). It passes the raw TCP WebSocket streams directly to Fargate tasks with sub-millisecond routing overhead, maximizing throughput and connection stability which is critical for real-time speech systems."

### Q2: How did you solve the problem of the bot interrupting itself when audio plays out of the user's speakers?
> **Answer:** "We implemented client-side Voice Activity Detection (VAD) with software-level echo feedback suppression. When the bot is silent, the client tracks the room's noise floor. As soon as the bot begins playing audio, the client dynamically increases the barge-in volume threshold by a scale factor of 1.6x of config settings and 2.2x of the noise floor. Additionally, we enforce consecutive-frame verification, requiring the volume to stay above this active threshold for 4 consecutive frames (~100ms) to trigger barge-in, effectively filtering out speaker echo and transient clicks."

### Q3: Why is the ACM Certificate requested in the `us-east-1` region if your main infrastructure is in `ap-south-1`?
> **Answer:** "AWS enforces a regional constraint for CloudFront custom SSL configurations. Because CloudFront is a global CDN, it can only access SSL certificates stored in AWS Certificate Manager (ACM) inside the **N. Virginia (`us-east-1`)** region. If the certificate is created in Mumbai, CloudFront won't be able to map the custom CNAME alias."

### Q4: Explain the TypeScript container build strategy. Why use a multi-stage Dockerfile?
> **Answer:** "We use a multi-stage Dockerfile to separate compile-time tools from runtime outputs. Stage 1 pulls Node, installs all devDependencies, and compiles TypeScript files down to raw JavaScript in `./dist/`. Stage 2 starts from a clean Node slim image, downloads *only* production dependencies (`npm install --omit=dev`), and copies the compiled JS and static assets from Stage 1. This keeps the production container image highly optimized, under 200MB, which minimizes storage costs and speeds up container deployments on AWS Fargate."
