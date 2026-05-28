import { SarvamAIClient } from 'sarvamai';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { Socket } from 'socket.io';

const SARVAM_API_KEY = process.env.SARVAM_API_KEY || '';
const LLM_REGION = process.env.KB_REGION || 'ap-south-1';
const LLM_MODEL = 'apac.amazon.nova-pro-v1:0';

export class UnifiedPipeline {
    private sarvam: SarvamAIClient;
    private bedrock: BedrockRuntimeClient;
    private socket: Socket;
    private systemPrompt: string;
    private history: Array<{ role: string; content: string }> = [];
    private audioBuffer: Buffer[] = [];
    private isActive = false;
    private detectedLang = 'hi-IN';

    constructor(socket: Socket, systemPrompt: string) {
        this.socket = socket;
        this.systemPrompt = systemPrompt;
        this.sarvam = new SarvamAIClient({ apiSubscriptionKey: SARVAM_API_KEY });
        this.bedrock = new BedrockRuntimeClient({ region: LLM_REGION });
    }

    async start(): Promise<void> {
        this.isActive = true;
        await this.speak('नमस्ते जी, मैं रिया बोल रही हूं जैन सेल्स कॉर्पोरेशन इंदौर से। आपकी क्या मदद कर सकती हूं?', 'hi-IN');
        this.socket.emit('sarvamReady');
    }

    async processAudio(data: Buffer): Promise<void> {
        if (this.isActive) this.audioBuffer.push(data);
    }

    async endAudioTurn(): Promise<void> {
        if (!this.isActive || !this.audioBuffer.length) return;
        const audio = Buffer.concat(this.audioBuffer);
        this.audioBuffer = [];
        try {
            const stt = await (this.sarvam.speechToText as any).transcribe({
                file: new Blob([audio], { type: 'audio/wav' }),
                model: 'saaras:v3',
                languageCode: 'unknown',
            });
            const text: string = stt?.transcript || '';
            if (!text.trim()) return;
            if (stt?.languageCode) this.detectedLang = stt.languageCode;
            console.log(`[Pipeline] (${this.detectedLang}): ${text}`);
            this.socket.emit('textOutput', { role: 'user', content: text });
            const reply = await this.llm(text);
            if (!reply) return;
            this.socket.emit('textOutput', { role: 'assistant', content: reply });
            await this.speak(reply, this.detectedLang);
        } catch (e) {
            console.error('[Pipeline] Error:', e);
            this.socket.emit('error', { message: 'Pipeline error', details: String(e) });
        }
    }

    private async llm(text: string): Promise<string> {
        this.history.push({ role: 'user', content: text });
        const cmd = new ConverseCommand({
            modelId: LLM_MODEL,
            system: [{ text: this.systemPrompt }],
            messages: this.history.map(m => ({ role: m.role as 'user'|'assistant', content: [{ text: m.content }] })),
            inferenceConfig: { maxTokens: 512, temperature: 0.7 }
        });
        const res = await this.bedrock.send(cmd);
        const reply = res.output?.message?.content?.[0]?.text || '';
        this.history.push({ role: 'assistant', content: reply });
        return reply;
    }

    private async speak(text: string, lang: string): Promise<void> {
        const res = await (this.sarvam.textToSpeech as any).convert({
            inputs: [text], target_language_code: lang, speaker: 'anand', model: 'bulbul:v3',
        });
        if (res?.audios?.[0]) {
            const buf = Buffer.from(res.audios[0], 'base64');
            for (let i = 0; i < buf.length; i += 4096)
                this.socket.emit('audioOutput', { data: buf.slice(i, i + 4096).toString('base64') });
            this.socket.emit('contentEnd', { type: 'AUDIO' });
            this.socket.emit('sarvamDone');
        }
    }

    stop(): void {
        this.isActive = false;
        this.audioBuffer = [];
        this.history = [];
    }
}
