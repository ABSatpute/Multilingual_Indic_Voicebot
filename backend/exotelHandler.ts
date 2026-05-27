/**
 * Exotel WebSocket Handler for Telephony Integration
 * Handles bidirectional audio streaming from Exotel to Nova Sonic
 *
 * Audio format: Raw LPCM (PCM16) 8kHz in BOTH directions.
 * No μ-law conversion needed. Pass base64 audio straight through.
 */

import { WebSocket, WebSocketServer } from 'ws';
import { NovaSonicBidirectionalStreamClient, StreamSession } from './client';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface ExotelMessage {
    event: string;
    streamSid?: string;
    stream_sid?: string;
    callSid?: string;
    call_sid?: string;
    media?: {
        payload: string;
        timestamp?: string;
    };
}

const TELEPHONY_SAMPLE_RATE = 8000;

const EXOTEL_AUDIO_INPUT_CONFIG = {
    mediaType: "audio/lpcm" as const,
    sampleRateHertz: TELEPHONY_SAMPLE_RATE,
    sampleSizeBits: 16,
    channelCount: 1,
    audioType: "SPEECH" as const,
    encoding: "base64"
};

export class ExotelWebSocketHandler {
    private wss: WebSocketServer;
    private sessions = new Map<string, StreamSession>();
    private bedrockClient: NovaSonicBidirectionalStreamClient;

    constructor(server: any, bedrockClient: NovaSonicBidirectionalStreamClient) {
        this.bedrockClient = bedrockClient;

        this.wss = new WebSocketServer({
            server,
            path: '/exotel'
        });

        this.wss.on('connection', (ws: WebSocket) => {
            console.log('[Exotel] New connection established');
            this.handleConnection(ws);
        });

        console.log('[Exotel] WebSocket server initialized on /exotel');
    }

    private async handleConnection(ws: WebSocket) {
        let sessionId: string | null = null;
        let session: StreamSession | null = null;
        let streamSid: string | null = null;
        let sessionClosed = false;

        const safeClose = async () => {
            if (sessionClosed || !session) return;
            sessionClosed = true;
            const s = session;
            session = null;
            try {
                await s.close();
            } catch (e) {
                console.error('[Exotel] Error closing session:', e);
            }
            if (sessionId) this.sessions.delete(sessionId);
        };

        ws.on('message', async (data: Buffer) => {
            try {
                const message: ExotelMessage = JSON.parse(data.toString());

                switch (message.event) {
                    case 'start':
                        streamSid = message.stream_sid || message.streamSid || null;
                        sessionId = streamSid || message.callSid || message.call_sid || `exotel-${Date.now()}`;
                        console.log(`[Exotel] Call started: ${sessionId}`);
                        session = await this.initializeNovaSession(sessionId, ws, streamSid);
                        this.sessions.set(sessionId, session);
                        break;

                    case 'media':
                        if (session && message.media?.payload) {
                            // Exotel sends raw PCM16 as base64 — decode to Buffer and pass directly
                            const pcmBuffer = Buffer.from(message.media.payload, 'base64');
                            await session.streamAudio(pcmBuffer);
                        }
                        break;

                    case 'stop':
                        console.log(`[Exotel] Call ended: ${sessionId}`);
                        await safeClose();
                        ws.close();
                        break;

                    default:
                        console.log(`[Exotel] Unknown event: ${message.event}`);
                }
            } catch (error) {
                console.error('[Exotel] Error processing message:', error);
            }
        });

        ws.on('close', async () => {
            console.log(`[Exotel] Connection closed: ${sessionId}`);
            await safeClose();
        });

        ws.on('error', (error) => {
            console.error('[Exotel] WebSocket error:', error);
        });
    }

    private async initializeNovaSession(
        sessionId: string,
        ws: WebSocket,
        streamSid: string | null
    ): Promise<StreamSession> {

        const session = this.bedrockClient.createStreamSession(sessionId, {
            enabledTools: ['search_knowledge_base']
        });

        let isInterrupted = false;

        // Register handlers BEFORE streaming starts
        session.onEvent('audioOutput', (audioOutputEvent: any) => {
            try {
                if (isInterrupted) {
                    console.log(`[Exotel] Dropping audio chunk - interrupted`);
                    return;
                }

                const base64Content = audioOutputEvent?.content;
                if (!base64Content) {
                    console.warn('[Exotel] audioOutput missing content field');
                    return;
                }

                // Nova Sonic outputs PCM16 8kHz as base64.
                // Exotel expects raw LPCM — send base64 directly, no re-encoding.
                const message = {
                    event: 'media',
                    stream_sid: streamSid || sessionId,
                    media: {
                        payload: base64Content
                    }
                };

                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(message));
                    console.log(`[Exotel] Sent audio response chunk to ${sessionId}`);
                }
            } catch (err) {
                console.error('[Exotel] Error sending audio output:', err);
            }
        });

        session.onEvent('bargeIn', (_data: any) => {
            console.log(`[Exotel] Barge-in detected for ${sessionId} - stopping audio`);
            isInterrupted = true;

            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    event: 'clear',
                    stream_sid: streamSid || sessionId
                }));
            }
        });

        session.onEvent('contentStart', (data: any) => {
            if (data?.role === 'ASSISTANT' || data?.type === 'AUDIO') {
                console.log(`[Exotel] New content started - resetting interrupted flag`);
                isInterrupted = false;
            }
        });

        session.onEvent('textOutput', (text: any) => {
            console.log(`[Exotel] Nova response text: ${text.content || text}`);
        });

        session.onEvent('error', (err: any) => {
            console.error(`[Exotel] Nova Sonic error for ${sessionId}:`, err);
        });

        // Setup session with telephony config
        await session.setupSessionAndPromptStart('kiara', TELEPHONY_SAMPLE_RATE);

        // Load Nova Sonic system prompt from the shared prompts file
        const promptPath = join(__dirname, '../public/prompts/default.md');
        const systemPrompt = readFileSync(promptPath, 'utf-8');

        console.log(`[SystemPrompt] Session ${sessionId}: Using system prompt (${systemPrompt.length} chars)`);
        await session.setupSystemPrompt(undefined, systemPrompt, 'kiara');

        await session.setupStartAudio(EXOTEL_AUDIO_INPUT_CONFIG);

        // Send greeting turn so Nova Sonic speaks first
        const greetingText = process.env.EXOTEL_GREETING ||
            'Greet the caller warmly and ask how you can help them today.';
        await session.sendTextInput(greetingText);

        console.log(`[Exotel] Sent greeting prompt for session ${sessionId}`);

        this.bedrockClient.initiateBidirectionalStreaming(sessionId);

        console.log(`[Exotel] Nova Sonic session initialized for ${sessionId}`);
        return session;
    }
}
