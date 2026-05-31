# Multilingual Indic Voicebot for Precise Engineers
## Architecture, Technical Stack, and Project Documentation

This document provides a comprehensive technical breakdown of the **Multilingual Indic Voicebot** developed for **Precise Engineers, Indore**. It details the architectural decisions, the core technologies, low-latency communication protocols, and smart Voice Activity Detection (VAD) algorithms.

---

## 1. Project Overview

The **Multilingual Indic Voicebot** is an enterprise-grade, low-latency, real-time voice assistant designed to automate inbound sales, product catalog inquiries, and customer service triage. 

### Key Capabilities:
* **Bilingual & Multilingual Auto-Switching:** Dynamically detects user speech in **12 different Indian regional languages** (Hindi, Tamil, Telugu, Kannada, Bengali, Malayalam, Marathi, Gujarati, Punjabi, Odia, Assamese, and English) and switches both browser listening and voice synthesis languages on-the-fly.
* **Retrieval-Augmented Generation (RAG):** Connects to a proprietary catalog database indexing pumps, motors, and cables via semantic search, preventing LLM hallucinations.
* **Accidental Barge-In Prevention:** Utilizes a smart client-side VAD engine that distinguishes human speech from background fans, keyboard typing, and microphone clicks.

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
12. **Audio Playback:** Backend streams audio chunks back to the client browser via WebSockets. Client decodes and plays PCM audio in real-time.

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


