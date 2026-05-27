/**
 * SarvamPipeline - STT → Bedrock LLM → TTS for regional Indian languages
 * Uses Sarvam AI for speech processing and Amazon Bedrock Nova Pro for LLM
 */

import { SarvamAIClient } from 'sarvamai';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { Socket } from 'socket.io';

const SARVAM_API_KEY = process.env.SARVAM_API_KEY || '';
const LLM_REGION = process.env.KB_REGION || 'ap-south-1';
const LLM_MODEL = 'apac.amazon.nova-pro-v1:0';

// Language code mapping: frontend value → Sarvam language code
const LANGUAGE_CODES: Record<string, string> = {
    'tamil':     'ta-IN',
    'telugu':    'te-IN',
    'kannada':   'kn-IN',
    'bengali':   'bn-IN',
    'malayalam': 'ml-IN',
    'marathi':   'mr-IN',
    'gujarati':  'gu-IN',
    'punjabi':   'pa-IN',
    'odia':      'od-IN',
    'assamese':  'as-IN',
    'hindi':     'hi-IN',
    'english':   'en-IN',
};

// Speaker voices per language (Sarvam bulbul:v3)
const LANGUAGE_SPEAKERS: Record<string, string> = {
    'ta-IN': 'shubh',
    'te-IN': 'shubh',
    'kn-IN': 'shubh',
    'bn-IN': 'shubh',
    'ml-IN': 'shubh',
    'mr-IN': 'shubh',
    'gu-IN': 'shubh',
    'pa-IN': 'shubh',
    'od-IN': 'shubh',
    'as-IN': 'shubh',
    'hi-IN': 'anand',
    'en-IN': 'anand',
};

export class SarvamPipeline {
    private sarvam: SarvamAIClient;
    private bedrock: BedrockRuntimeClient;
    private socket: Socket;
    private language: string;
    private languageCode: string;
    private systemPrompt: string;
    private conversationHistory: Array<{ role: string; content: string }> = [];
    private audioBuffer: Buffer[] = [];
    private isActive = false;
    private sttSession: any = null;

    constructor(socket: Socket, language: string, systemPrompt: string) {
        this.socket = socket;
        this.language = language;
        this.languageCode = LANGUAGE_CODES[language] || 'hi-IN';
        this.systemPrompt = systemPrompt;
        this.sarvam = new SarvamAIClient({ apiSubscriptionKey: SARVAM_API_KEY });
        this.bedrock = new BedrockRuntimeClient({ region: LLM_REGION });
    }

    async start(): Promise<void> {
        this.isActive = true;
        console.log(`[Sarvam] Starting pipeline for ${this.language} (${this.languageCode})`);

        // Send greeting via TTS
        const greeting = this.getGreeting();
        await this.speakText(greeting);
        this.socket.emit('sarvamReady');
    }

    async processAudio(audioData: Buffer): Promise<void> {
        if (!this.isActive) return;
        this.audioBuffer.push(audioData);
    }

    async endAudioTurn(): Promise<void> {
        if (!this.isActive || this.audioBuffer.length === 0) return;

        const combined = Buffer.concat(this.audioBuffer);
        this.audioBuffer = [];

        try {
            // STT: transcribe audio
            const transcript = await this.transcribe(combined);
            if (!transcript?.trim()) return;

            console.log(`[Sarvam] Transcript: ${transcript}`);
            this.socket.emit('textOutput', { role: 'user', content: transcript });

            // LLM: get response
            const response = await this.getLLMResponse(transcript);
            if (!response?.trim()) return;

            console.log(`[Sarvam] LLM response: ${response}`);
            this.socket.emit('textOutput', { role: 'assistant', content: response });

            // TTS: speak response
            await this.speakText(response);

        } catch (error) {
            console.error('[Sarvam] Pipeline error:', error);
            this.socket.emit('error', { message: 'Sarvam pipeline error', details: String(error) });
        }
    }

    private async transcribe(audio: Buffer): Promise<string> {
        const response = await (this.sarvam.speechToText as any).transcribe({
            file: new Blob([audio], { type: 'audio/wav' }),
            model: 'saaras:v3',
            languageCode: this.languageCode,
        });
        return response?.transcript || '';
    }

    private async getLLMResponse(userText: string): Promise<string> {
        this.conversationHistory.push({ role: 'user', content: userText });

        const messages = this.conversationHistory.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: [{ text: m.content }]
        }));

        const command = new ConverseCommand({
            modelId: LLM_MODEL,
            system: [{ text: this.systemPrompt }],
            messages,
            inferenceConfig: { maxTokens: 512, temperature: 0.7 }
        });

        const result = await this.bedrock.send(command);
        const responseText = result.output?.message?.content?.[0]?.text || '';

        this.conversationHistory.push({ role: 'assistant', content: responseText });
        return responseText;
    }

    private async speakText(text: string): Promise<void> {
        const speaker = LANGUAGE_SPEAKERS[this.languageCode] || 'shubh';

        const response = await (this.sarvam.textToSpeech as any).convert({
            inputs: [text],
            target_language_code: this.languageCode,
            speaker,
            model: 'bulbul:v3',
        });

        const audios = (response as any).audios;
        if (audios && audios.length > 0) {
            const audioBase64 = audios[0];
            const audioBuffer = Buffer.from(audioBase64, 'base64');
            // Send in chunks like Nova Sonic does
            const chunkSize = 4096;
            for (let i = 0; i < audioBuffer.length; i += chunkSize) {
                const chunk = audioBuffer.slice(i, i + chunkSize);
                this.socket.emit('audioOutput', { data: chunk.toString('base64') });
            }
            this.socket.emit('contentEnd', { type: 'AUDIO' });
        }
    }

    private getGreeting(): string {
        const greetings: Record<string, string> = {
            'ta-IN': 'வணக்கம்! நான் ஜெயின் சேல்ஸ் கார்ப்பரேஷன் இந்தூரிலிருந்து ரியா பேசுகிறேன். உங்களுக்கு எப்படி உதவலாம்?',
            'te-IN': 'నమస్కారం! నేను జైన్ సేల్స్ కార్పొరేషన్ ఇండోర్ నుండి రియా మాట్లాడుతున్నాను. మీకు ఎలా సహాయం చేయగలను?',
            'kn-IN': 'ನಮಸ್ಕಾರ! ನಾನು ಜೈನ್ ಸೇಲ್ಸ್ ಕಾರ್ಪೊರೇಷನ್ ಇಂದೋರ್ ನಿಂದ ರಿಯಾ ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ. ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?',
            'bn-IN': 'নমস্কার! আমি জৈন সেলস কর্পোরেশন ইন্দোর থেকে রিয়া বলছি। আপনাকে কীভাবে সাহায্য করতে পারি?',
            'ml-IN': 'നമസ്കാരം! ഞാൻ ജൈൻ സെയിൽസ് കോർപ്പറേഷൻ ഇൻഡോറിൽ നിന്ന് റിയ സംസാരിക്കുന്നു. എങ്ങനെ സഹായിക്കാം?',
            'hi-IN': 'नमस्ते जी, मैं रिया बोल रही हूं जैन सेल्स कॉर्पोरेशन इंदौर से। आपकी क्या मदद कर सकती हूं?',
            'en-IN': 'Hello, this is Riya from Jain Sales Corporation, Indore. How may I help you today?',
        };
        return greetings[this.languageCode] || greetings['en-IN'];
    }

    stop(): void {
        this.isActive = false;
        this.audioBuffer = [];
        this.conversationHistory = [];
        console.log(`[Sarvam] Pipeline stopped for ${this.language}`);
    }
}
