# Multilingual Indic Voicebot for Precise Engineers
## Architecture, Technical Stack, and Project Documentation

This document provides a comprehensive technical breakdown of the **Multilingual Indic Voicebot** developed for **Precise Engineers, Indore**. It details the architectural decisions, the core technologies, low-latency communication protocols, smart Voice Activity Detection (VAD) algorithms, and key points to emphasize during technical job interviews.

---

## 1. Project Overview

The **Multilingual Indic Voicebot** is an enterprise-grade, low-latency, real-time voice assistant designed to automate inbound sales, product catalog inquiries, and customer service triage. 

### Key Capabilities:
* **Bilingual & Multilingual Auto-Switching:** Dynamically detects user speech in **12 different Indian regional languages** (Hindi, Tamil, Telugu, Kannada, Bengali, Malayalam, Marathi, Gujarati, Punjabi, Odia, Assamese, and English) and switches both browser listening and voice synthesis languages on-the-fly.
* **Retrieval-Augmented Generation (RAG):** Connects to a proprietary catalog database indexing pumps, motors, and cables via semantic search, preventing LLM hallucinations.
* **Accidental Barge-In Prevention:** Utilizes a smart client-side VAD engine that distinguishes human speech from background fans, keyboard typing, and microphone clicks.
* **Interactive 3D Avatar:** A WebGL-rendered 3D holographic avatar that performs real-time lip-syncing based on synthesized audio visemes.

---

## 2. Technical Stack & Technology Purpose

The project is structured as a modular monorepo containing three core tiers: **Client Web App**, **Application Backend**, and **Infrastructure as Code (IaC)**.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          CLIENT WEB APP (UI)                            │
│    HTML5/CSS3  •  Vanilla JS  •  Web Audio API  •  Web Speech API       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ (Socket.io - WebSockets / WSS)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        APPLICATION BACKEND                              │
│                Node.js  •  TypeScript  •  Express                       │
└──────────┬─────────────────────────┬─────────────────────────┬──────────┘
           │ (REST / API)            │ (SDK)                   │ (REST)
           ▼                         ▼                         ▼
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│     SARVAM AI      │    │   AMAZON BEDROCK   │    │   AMAZON BEDROCK   │
│  STT (saaras:v3)   │    │  LLM (nova-pro)    │    │   KNOWLEDGE BASE   │
│  TTS (bulbul:v3)   │    │                    │    │   (RAG / Vector)   │
└────────────────────┘    └────────────────────┘    └────────────────────┘
```

### A. Frontend (Client-Side)
* **Web Audio API:** Used to capture raw microphone input, handle buffer processing, track volume levels (Root Mean Square / RMS), and decode streaming PCM audio chunks on the fly.
* **Web Speech API (`SpeechRecognition`):** Utilized for local, client-side backup transcription to support low-bandwidth connections and display real-time text feedback to the user.
* **WebGL & Canvas:** Renders the 3D holographic avatar mesh and animates mouth shapes based on voice frequencies.
* **Socket.IO Client:** Establishes a persistent, bidirectional WebSocket connection with the backend server for low-latency streaming.

### B. Backend (Server-Side)
* **Node.js & TypeScript:** Strongly-typed backend environment providing compilation safety, efficient asynchronous event loops, and low CPU overhead.
* **Express:** Light REST API router hosting server health checks (`/health`) and serving static client assets.
* **Socket.IO Server:** Handles WebSocket connection state, manages audio chunk streams, and coordinates orchestrations per client session.

### C. Artificial Intelligence & Speech Services
* **Sarvam AI APIs:**
  * **Speech-to-Text (STT) (`saaras:v3`):** Processes base64-encoded PCM audio streams. By passing `languageCode: 'unknown'`, it acts as a zero-shot language detector.
  * **Text-to-Speech (TTS) (`bulbul:v3`):** Converts model output text into high-quality Indic speech (using the `bulbul:v3` model and `anand` voice), outputting raw PCM buffers.
* **Amazon Bedrock (`nova-pro-v1:0`):** The core large language model (LLM) configured with the agent's sales persona (Riya). It manages conversational state, extracts intent, and triggers tools.
* **Amazon Bedrock Knowledge Bases (RAG):** Indexes the product catalog (PDF/Docs) in a vector database on S3. It performs semantic chunking and high-accuracy search using Amazon Bedrock Agent Runtime APIs (`RetrieveAndGenerate`).

### D. DevOps & AWS Infrastructure
* **AWS Cloud Development Kit (CDK) (Python):** Deploys the entire infrastructure as code, ensuring 100% reproducible environments.
* **AWS ECS Fargate:** Hosts the backend Node.js server inside serverless, auto-scaling Docker containers.
* **Network Load Balancer (NLB):** Routes WebSocket connections with session stickiness.
* **Amazon CloudFront:** Serves static frontend resources and proxies WebSocket (`/socket.io`) requests over HTTPS/WSS, resolving cross-origin (CORS) issues and securing communication.

---

## 3. Core Architecture & Data Flow

When a user speaks into the microphone, the voicebot processes the input through a highly synchronized pipeline:

1. **User Input:** User speaks a query (e.g. "Motors matching Kirloskar brand?").
2. **Client VAD & Thresholding:** Web Audio API captures audio chunks. VAD debounces microphone startup and speaker feedback.
3. **Audio Streaming:** Base64-encoded PCM chunks are sent to backend over Socket.IO WebSockets.
4. **Turn End Detection:** User stops speaking. VAD triggers silence and client emits `sarvamAudioEnd` to the backend.
5. **Speech-to-Text (STT):** Backend posts the complete PCM buffer to Sarvam STT with `languageCode: 'unknown'`.
6. **Language Recognition:** Sarvam returns the transcript and auto-detected language (e.g., `'hi-IN'`).
7. **Client Sync:** Backend emits `languageDetected` over Socket.IO to browser client, which restarts local SpeechRecognition in the new language.
8. **Bedrock Conversational LLM:** Backend invokes Amazon Bedrock with the conversation history and transcript.
9. **RAG Tool Execution:** Bedrock LLM parses the inquiry, calls `search_knowledge_base` silently, retrieves catalog results from Bedrock Knowledge Base vector store, and feeds it back into context.
10. **LLM Prefix Tagging:** Bedrock generates a response prefixed with language tag (e.g., `[hi-IN] हमारे पास किरलोस्कर...`).
11. **Text-to-Speech (TTS):** Backend parses and strips the language tag, updates pipeline language state, and calls Sarvam TTS to convert the text into PCM chunks.
12. **Audio Playback & Avatar Sync:** Backend streams audio chunks back to the client browser via WebSockets. Client decodes/plays PCM and animates the 3D hologram mouth shapes.

---

## 4. Key Engineering Implementations

### A. Smart Voice Activity Detection (VAD) & Barge-In
A common issue in voice bots is **false interruptions** caused by microphone clicks, ambient fan noise, or speaker echo loopback. The client-side VAD in `main.js` implements the following mitigations:
* **Adaptive Noise Floor Tracking:** When both user and bot are silent, the client tracks ambient room noise using a running average:
  $$\text{NoiseFloor} = \text{NoiseFloor} \times 0.98 + \text{RMS} \times 0.02$$
* **Consecutive Frame Speech Verification:** The user's microphone volume must exceed the active threshold for at least **4 consecutive audio frames** (~50–120ms of sustained sound) to trigger an interruption, filtering out short keyboard taps or background pops.
* **Acoustic Echo Scaling (Software-level Echo Cancellation):** While the assistant is speaking, the threshold to trigger barge-in is dynamically scaled up:
  $$\text{ActiveThreshold} = \max(\text{DefaultThreshold} \times 1.6, \text{NoiseFloor} \times 2.2)$$
  This prevents the bot's own voice from leaking back into the microphone and cutting itself off.
* **Assistant Playback Guard:** Disables barge-in during the first 1000ms of assistant playback to bypass microphone startup spikes.

### B. Low-Latency Streaming
* **Bypassing Filesystem Writes:** Raw audio is handled entirely in memory as Node `Buffer` segments, streamed directly to the APIs.
* **WebSocket Audio Chunking:** Downsamples audio to 16kHz linear PCM, sending 512-sample base64 packets over Socket.IO to decrease overhead compared to heavy media files.
* **Stream Multiplexing:** Audio playback starts on the browser as soon as the first PCM chunk arrives from the backend, instead of waiting for the full sentence synthesis to finish.

---

## 5. Interview Q&A Cheatsheet (For Job Interviews)

#### **Q1: Why did you choose Node.js/TypeScript over Python for the backend?**
> *"While Python is dominant in ML/AI research, Node.js provides a vastly superior event-driven, non-blocking I/O model for real-time WebSocket streaming. Managing multiple concurrent bidirectional audio streams requires handling events rapidly without blocking the thread pool. TypeScript gives us the type safety needed to build reliable real-time pipelines, and the backend integrates cleanly with AWS SDKs and Node-based audio decoders."*

#### **Q2: How did you implement automatic language switching?**
> *"We implemented a two-part synchronization flow. First, we configured Sarvam's Speech-to-Text service with `languageCode: 'unknown'`, which auto-detects the spoken Indic language and returns an ISO language code (e.g. `'hi-IN'`). Second, we instructed the LLM (Amazon Bedrock) via system prompt to prefix its response text with bracketed ISO language tags (e.g. `[mr-IN]`). The backend server parses this tag, updates the synthesis pipeline, and emits a `languageDetected` event. The browser client receives this event to update the UI dropdown and restart local browser speech recognition in the correct language."*

#### **Q3: How did you handle the RAG integration without introducing lag?**
> *"We utilized Amazon Bedrock Knowledge Bases and called the `RetrieveAndGenerate` API. Rather than building a separate database query agent, we exposed this as a structured tool (`search_knowledge_base`) to the LLM. When a user asks about product model numbers, prices, or recommendations, the LLM makes a silent, direct tool call. We set strict generation rules (short sentences, no markdown lists) so the vector database context is synthesized into concise spoken formats, minimizing the TTS text size and reducing voice generation latency."*

#### **Q4: How did you prevent the bot from interrupting itself when it speaks?**
> *"This is a classic problem of acoustic echo. We built an adaptive barge-in filter on the client. When the bot speaks, the code temporarily increases the microphone amplitude threshold required to interrupt the bot by 1.6x. We also track the running noise floor of the room. If a sound is detected, it must stay above this elevated threshold for 4 consecutive frames (~100ms) to ensure it is the user's voice rather than speaker echo or ambient AC fan noise."*

#### **Q5: How is the infrastructure set up to scale?**
> *"We built the infrastructure using AWS CDK. The application is dockerized and runs on AWS ECS Fargate, providing serverless, horizontal scaling. Connections are routed through a Network Load Balancer (NLB) to preserve persistent WebSockets. At the edge, we set up an Amazon CloudFront distribution to serve static HTML/JS assets, terminate SSL/TLS certificates, and proxy WebSocket traffic, which secures the app under HTTPS/WSS and reduces latency by utilizing AWS edge locations."*
