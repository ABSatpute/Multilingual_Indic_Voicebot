import express from 'express';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import dotenv from 'dotenv';
import path from 'path';
// Load environment variables from central root-level .env file
dotenv.config({ path: path.join(__dirname, '../.env'), override: true });
// Fallback to local .env in the backend folder
dotenv.config({ override: true });

console.log('[DEBUG] Loaded SARVAM_API_KEY:', process.env.SARVAM_API_KEY ? `${process.env.SARVAM_API_KEY.substring(0, 15)}...` : 'undefined');

import http from 'http';
import { Server } from 'socket.io';
import { Buffer } from 'node:buffer';
import { UnifiedPipeline } from './SarvamPipeline';

const app = express();
const server = http.createServer(app);

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : '*';

console.log('[DEBUG] CORS Allowed Origins:', allowedOrigins);

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST']
    },
    perMessageDeflate: false
});

// Track active Sarvam pipelines per socket
const sarvamPipelines = new Map<string, UnifiedPipeline>();

// Serve static files from the public directory
app.use(express.static(path.join(process.cwd(), 'public')));

// Socket.IO connection handler
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    let audioChunksCount = 0;

    const connectionInterval = setInterval(() => {
        const connectionCount = Object.keys(io.sockets.sockets).length;
        console.log(`Active socket connections: ${connectionCount}`);
    }, 60000);

    // Audio input handler
    socket.on('audioInput', async (audioData) => {
        audioChunksCount++;
        if (audioChunksCount % 100 === 1) {
            console.log(`[Server] audioInput received, count: ${audioChunksCount}, client: ${socket.id}`);
        }
        try {
            const sarvam = sarvamPipelines.get(socket.id);
            if (sarvam) {
                const audioBuffer = typeof audioData === 'string'
                    ? Buffer.from(audioData, 'base64')
                    : Buffer.from(audioData);
                await sarvam.processAudio(audioBuffer);
            }
        } catch (error) {
            console.error('Error processing audio:', error);
            socket.emit('error', {
                message: 'Error processing audio',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // Sarvam pipeline start (for all languages)
    socket.on('sarvamStart', async (data: { 
        language: string; 
        systemPrompt: string; 
        voiceId?: string; 
        temperature?: number;
        topP?: number;
        maxTokens?: number;
        enabledTools?: string[];
    }) => {
        console.log('[Server] sarvamStart received from client:', socket.id, 'lang:', data.language);
        try {
            const existing = sarvamPipelines.get(socket.id);
            if (existing) { 
                existing.stop(); 
                sarvamPipelines.delete(socket.id); 
            }
            const pipeline = new UnifiedPipeline(
                socket, 
                data.systemPrompt, 
                data.voiceId || 'anand', 
                data.language || 'hindi',
                data.temperature,
                data.topP,
                data.maxTokens,
                data.enabledTools
            );
            sarvamPipelines.set(socket.id, pipeline);
            await pipeline.start();
        } catch (error) {
            console.error('[Sarvam] Error starting pipeline:', error);
            socket.emit('error', { message: 'Failed to start Sarvam pipeline', details: String(error) });
        }
    });

    // Signal end of user audio turn for Sarvam (VAD replacement)
    socket.on('sarvamAudioEnd', async () => {
        console.log('[Server] sarvamAudioEnd received from client:', socket.id);
        const sarvam = sarvamPipelines.get(socket.id);
        if (sarvam) await sarvam.endAudioTurn();
    });

    // Handle assistant interruption/barge-in
    socket.on('interruptAssistant', () => {
        console.log('[Server] interruptAssistant received from client:', socket.id);
        const sarvam = sarvamPipelines.get(socket.id);
        if (sarvam) sarvam.interrupt();
    });


    // Update active Sarvam configuration in real-time
    socket.on('sarvamUpdateConfig', async (data: { 
        language?: string; 
        systemPrompt?: string; 
        voiceId?: string; 
        temperature?: number;
        topP?: number;
        maxTokens?: number;
        enabledTools?: string[];
    }) => {
        console.log('[Server] sarvamUpdateConfig received from client:', socket.id, data);
        try {
            const sarvam = sarvamPipelines.get(socket.id);
            if (sarvam) {
                await sarvam.updateConfig(data);
            }
        } catch (error) {
            console.error('[Sarvam] Error updating pipeline config:', error);
        }
    });

    // Text input handler (for typing mode)
    socket.on('textInput', async (data) => {
        console.log('[Server] textInput received from client:', socket.id, 'text:', data.content);
        try {
            const sarvam = sarvamPipelines.get(socket.id);
            if (sarvam) {
                await sarvam.handleTextInput(data.content);
            }
        } catch (error) {
            console.error('Error processing text input:', error);
            socket.emit('error', {
                message: 'Error processing text input',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    });

    socket.on('stopAudio', async () => {
        try {
            const sarvam = sarvamPipelines.get(socket.id);
            if (sarvam) {
                await sarvam.endAudioTurn();
                sarvam.stop();
                sarvamPipelines.delete(socket.id);
            }
            socket.emit('sessionClosed');
        } catch (error) {
            console.error('Error stopping streaming:', error);
            socket.emit('sessionClosed');
        }
    });

    socket.on('disconnect', async () => {
        console.log('Client disconnected:', socket.id);
        clearInterval(connectionInterval);

        const sarvam = sarvamPipelines.get(socket.id);
        if (sarvam) { 
            sarvam.stop(); 
            sarvamPipelines.delete(socket.id); 
        }
    });
});

// Get available tools endpoint
app.get('/api/tools', (_req, res) => {
    res.status(200).json({
        tools: [
            {
                name: 'search_knowledge_base',
                description: 'Call this tool for ANY question about which product to use, specifications, price, or stock availability.'
            }
        ]
    });
});

// Health check endpoint
app.get('/health', (_req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        activeSessions: sarvamPipelines.size,
        socketConnections: Object.keys(io.sockets.sockets).length
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';
server.listen(Number(PORT), HOST, () => {
    console.log(`Server listening on ${HOST}:${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});

process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    const forceExitTimer = setTimeout(() => {
        console.error('Forcing server shutdown after timeout');
        process.exit(1);
    }, 5000);

    try {
        await new Promise(resolve => io.close(resolve));
        console.log('Socket.IO server closed');
        
        for (const [id, pipeline] of sarvamPipelines) {
            pipeline.stop();
        }
        sarvamPipelines.clear();

        await new Promise(resolve => server.close(resolve));
        clearTimeout(forceExitTimer);
        console.log('Server shut down');
        process.exit(0);
    } catch (error) {
        console.error('Error during server shutdown:', error);
        process.exit(1);
    }
});
