import { SarvamAIClient } from 'sarvamai';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { Socket } from 'socket.io';

const KB_RESULT_MAX_CHARS = 2000;
const MEMORY_QUERY_LIMIT = 3;
const LLM_TIMEOUT_MS = 30000;
const TTS_CHUNK_SIZE = 150;

function getLanguageName(code: string): string {
    const codes: Record<string, string> = {
        'hi-in': 'Hindi',
        'en-in': 'English',
        'ta-in': 'Tamil',
        'te-in': 'Telugu',
        'kn-in': 'Kannada',
        'bn-in': 'Bengali',
        'ml-in': 'Malayalam',
        'mr-in': 'Marathi',
        'gu-in': 'Gujarati',
        'pa-in': 'Punjabi',
        'od-in': 'Odia',
        'as-in': 'Assamese'
    };
    return codes[code.toLowerCase()] || code;
}

// Map legacy UI voice IDs to Sarvam SDK speakers (bulbul:v2)
const SDK_SPEAKER_MAP: Record<string, string> = {
    'priya': 'anushka',
    'neha': 'manisha',
    'kavya': 'vidya',
    'anand': 'abhilash',
    'rahul': 'karun',
    'shubh': 'hitesh'
};

function addWavHeader(pcmBuffer: Buffer, sampleRate: number): Buffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = pcmBuffer.length;
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // Linear PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmBuffer]);
}

function splitTextIntoChunks(text: string, maxLen = 450): string[] {
    const chunks: string[] = [];
    let current = '';
    
    // Protect punctuation inside numbers (1,500 / 1.5 HP) from being split.
    // Temporarily replace intra-number comma/dot with a placeholder.
    const protectedText = text.replace(/(?<=\d)[,.](?=\d)/g, (m) => m === ',' ? '\uE000' : '\uE001');
    
    // Split by sentence / clause punctuation or newlines
    const parts = protectedText.split(/([.!?।|,\n]+)/);
    
    for (let i = 0; i < parts.length; i++) {
        let part = parts[i];
        if (!part) continue;
        // Restore protected punctuation
        part = part.replace(/\uE000/g, ',').replace(/\uE001/g, '.');
        
        if ((current + part).length > maxLen) {
            if (current.trim()) {
                chunks.push(current.trim());
                current = '';
            }
            
            // If a single part is longer than maxLen, split it by spaces
            if (part.length > maxLen) {
                const words = part.split(/\s+/);
                let subChunk = '';
                for (const word of words) {
                    if ((subChunk + ' ' + word).length > maxLen) {
                        if (subChunk.trim()) {
                            chunks.push(subChunk.trim());
                        }
                        subChunk = word;
                    } else {
                        subChunk = subChunk ? subChunk + ' ' + word : word;
                    }
                }
                if (subChunk.trim()) {
                    current = subChunk;
                }
            } else {
                current = part;
            }
        } else {
            current += part;
        }
    }
    
    if (current.trim()) {
        chunks.push(current.trim());
    }
    
    return chunks.filter(c => c.length > 0);
}

const VOICE_NAMES: Record<string, Record<string, string>> = {
    'priya': {
        'hindi': 'प्रिया', 'english': 'Priya', 'tamil': 'பிரியா', 'telugu': 'ప్రియ',
        'kannada': 'ಪ್ರಿಯಾ', 'bengali': 'প্রিয়া', 'malayalam': 'പ്രിയ', 'marathi': 'प्रिया',
        'gujarati': 'પ્રિયા', 'punjabi': 'ਪ੍ਰਿਆ', 'odia': 'ପ୍ରିୟା', 'assamese': 'প্ৰিয়া'
    },
    'neha': {
        'hindi': 'नेहा', 'english': 'Neha', 'tamil': 'நேகா', 'telugu': 'నేహా',
        'kannada': 'ನೇಹಾ', 'bengali': 'নেহা', 'malayalam': 'നേഹ', 'marathi': 'नेहा',
        'gujarati': 'નેહા', 'punjabi': 'ਨੇਹਾ', 'odia': 'ନେହା', 'assamese': 'নেহা'
    },
    'kavya': {
        'hindi': 'काव्या', 'english': 'Kavya', 'tamil': 'காவியா', 'telugu': 'కావ్య',
        'kannada': 'ಕಾವ್ಯಾ', 'bengali': 'কাব্যা', 'malayalam': 'കാവ്യ', 'marathi': 'काव्या',
        'gujarati': 'કાવ્યા', 'punjabi': 'ਕਾਵਿਆ', 'odia': 'କାବ୍ୟା', 'assamese': 'কাব্যা'
    },
    'anand': {
        'hindi': 'आनंद', 'english': 'Anand', 'tamil': 'ஆனந்த்', 'telugu': 'ఆనంద్',
        'kannada': 'ಆನಂದ್', 'bengali': 'আনন্দ', 'malayalam': 'ആനന്ദ്', 'marathi': 'आनंद',
        'gujarati': 'આનંદ', 'punjabi': 'ਆਨੰਦ', 'odia': 'ଆନନ୍ଦ', 'assamese': 'আনন্দ'
    },
    'rahul': {
        'hindi': 'राहुल', 'english': 'Rahul', 'tamil': 'ராகுல்', 'telugu': 'రాహుల్',
        'kannada': 'ರಾಹುಲ್', 'bengali': 'রাহুল', 'malayalam': 'രാഹുൽ', 'marathi': 'राहुल',
        'gujarati': 'રાહુલ', 'punjabi': 'ਰਾਹੁਲ', 'odia': 'ରାହୁଲ', 'assamese': 'ৰাহুল'
    },
    'shubh': {
        'hindi': 'शुभ', 'english': 'Shubh', 'tamil': 'சுப்', 'telugu': 'శుభ్',
        'kannada': 'ಶುಭ್', 'bengali': 'শুভ', 'malayalam': 'ശുഭ്', 'marathi': 'शुभ',
        'gujarati': 'શુભ', 'punjabi': 'ਸ਼ੁਭ', 'odia': 'ଶୁଭ', 'assamese': 'শুভ'
    }
};

function getProcessedSystemPrompt(originalPrompt: string, voiceId: string): string {
    if (!originalPrompt) return originalPrompt;
    
    const voiceLower = voiceId.toLowerCase();
    const isMale = ['anand', 'rahul', 'shubh'].includes(voiceLower);
    
    let englishName = 'Priya';
    if (voiceLower === 'neha') englishName = 'Neha';
    else if (voiceLower === 'kavya') englishName = 'Kavya';
    else if (voiceLower === 'anand') englishName = 'Anand';
    else if (voiceLower === 'rahul') englishName = 'Rahul';
    else if (voiceLower === 'shubh') englishName = 'Shubh';
    
    let prompt = originalPrompt;
    
    prompt = prompt.replace(/\bRiya\b/g, englishName);
    prompt = prompt.replace(/\briya\b/g, englishName.toLowerCase());
    prompt = prompt.replace(/\bRIYA\b/g, englishName.toUpperCase());
    
    const riyaReplacements: Record<string, string> = {
        'ria': englishName,
        'Ria': englishName,
        'रिया': VOICE_NAMES[voiceLower]?.['hindi'] || englishName,
        'ரியா': VOICE_NAMES[voiceLower]?.['tamil'] || englishName,
        'రియా': VOICE_NAMES[voiceLower]?.['telugu'] || englishName,
        'ರಿಯಾ': VOICE_NAMES[voiceLower]?.['kannada'] || englishName,
        'রিয়া': VOICE_NAMES[voiceLower]?.['bengali'] || englishName,
        'റിയ': VOICE_NAMES[voiceLower]?.['malayalam'] || englishName,
        'રિયા': VOICE_NAMES[voiceLower]?.['gujarati'] || englishName,
        'ਰੀਆ': VOICE_NAMES[voiceLower]?.['punjabi'] || englishName,
        'ରିୟା': VOICE_NAMES[voiceLower]?.['odia'] || englishName,
        'ৰিয়া': VOICE_NAMES[voiceLower]?.['assamese'] || englishName
    };
    
    for (const [key, value] of Object.entries(riyaReplacements)) {
        prompt = prompt.split(key).join(value);
    }
    
    if (isMale) {
        prompt = prompt.replace(/\(female, senior sales executive\)/gi, `(male, senior sales executive)`);
        prompt = prompt.replace(/\bfeminine patterns\b/gi, `masculine patterns`);
        
        const verbReplacements: Record<string, string> = {
            '"kar dungi,"': '"kar dunga,"',
            '"bata sakti hoon,"': '"bata sakta hoon,"',
            '"bhej dungi,"': '"bhej dunga,"',
            '"note kar leti hoon"': '"note kar leta hoon"',
            'बोल रही हूं': 'बोल रहा हूं',
            'कर सकती हूं': 'कर सकता हूं',
            'बोल रही हूँ': 'बोल रहा हूँ',
            'कर सकती हूँ': 'कर सकता हूँ',
            'भेज देती हूँ': 'भेज देता हूँ',
            'भेज देती हूं': 'भेज देता हूं',
            'करा देती हूँ': 'करा देता हूँ',
            'करा देती हूं': 'करा देता हूं',
            'कर देती हूँ': 'कर देता हूँ',
            'कर देती हूं': 'कर देता हूं',
            'करती हूँ': 'करता हूँ',
            'करती हूं': 'करता हूं',
            'बना देती हूँ': 'बना देता हूँ',
            'बना देती हूं': 'बना देता हूं',
            'बोल रही': 'बोल रहा',
            'कर सकती': 'कर सकता',
            'करती': 'करता',
            'बोलती': 'बोलता',
            'भेज देती': 'भेज देता',
            'भेज दूंगी': 'भेज दूंगा',
            'करूँगी': 'करूँगा',
            'करूंगी': 'करूंगा',
            'सकती हूँ': 'सकता हूँ',
            'सकती हूं': 'सकता हूं',
            'करू शकते': 'करू शकतो',
            'બોલી રહી છું': 'બોલી રહ્યો છું',
            'ਬੋਲ ਰਹੀ ਹਾਂ': 'ਬੋਲ ਰਿਹਾ ਹਾਂ',
            'ਕਰ ਸਕਦੀ ਹਾਂ': 'ਕਰ ਸਕਦਾ ਹਾਂ'
        };
        
        for (const [key, value] of Object.entries(verbReplacements)) {
            prompt = prompt.split(key).join(value);
        }
    }
    
    return prompt;
}

export class UnifiedPipeline {
    private sarvam: SarvamAIClient;
    private bedrock: BedrockRuntimeClient;
    private bedrockAgent: BedrockAgentRuntimeClient;
    private history: any[] = [];
    private audioBuffer: Buffer[] = [];
    private isActive = false;
    private detectedLang = 'hi-IN';
    private turnCounter = 0;
    private textOnly = false;
    private recentKBQueries: string[] = [];
    private lastKBResultText = '';

    constructor(
        private socket: Socket,
        private systemPrompt: string,
        private voiceId = 'priya',
        private language = 'hindi',
        private temperature = 0.7,
        private topP = 0.9,
        private maxTokens = 512,
        private enabledTools: string[] = ['search_knowledge_base'],
        textOnly = false,
        private speechSampleRate = 24000
    ) {
        this.textOnly = textOnly;
        const sarvamKey = process.env.SARVAM_API_KEY || '';
        const llmRegion = process.env.KB_REGION || 'ap-south-1';
        this.sarvam = new SarvamAIClient({ apiSubscriptionKey: sarvamKey });
        this.bedrock = new BedrockRuntimeClient({ region: llmRegion });
        this.bedrockAgent = new BedrockAgentRuntimeClient({ region: llmRegion });
    }

    async start(): Promise<void> {
        this.isActive = true;
        this.turnCounter++;
        const currentTurn = this.turnCounter;
        
        const voiceLower = (this.voiceId || 'priya').toLowerCase();
        const isMale = ['anand', 'rahul', 'shubh'].includes(voiceLower);
        
        let englishName = 'Priya';
        if (voiceLower === 'neha') englishName = 'Neha';
        else if (voiceLower === 'kavya') englishName = 'Kavya';
        else if (voiceLower === 'anand') englishName = 'Anand';
        else if (voiceLower === 'rahul') englishName = 'Rahul';
        else if (voiceLower === 'shubh') englishName = 'Shubh';

        const nameHindi = VOICE_NAMES[voiceLower]?.['hindi'] || englishName;
        const nameEnglish = VOICE_NAMES[voiceLower]?.['english'] || englishName;
        const nameTamil = VOICE_NAMES[voiceLower]?.['tamil'] || englishName;
        const nameTelugu = VOICE_NAMES[voiceLower]?.['telugu'] || englishName;
        const nameKannada = VOICE_NAMES[voiceLower]?.['kannada'] || englishName;
        const nameBengali = VOICE_NAMES[voiceLower]?.['bengali'] || englishName;
        const nameMalayalam = VOICE_NAMES[voiceLower]?.['malayalam'] || englishName;
        const nameMarathi = VOICE_NAMES[voiceLower]?.['marathi'] || englishName;
        const nameGujarati = VOICE_NAMES[voiceLower]?.['gujarati'] || englishName;
        const namePunjabi = VOICE_NAMES[voiceLower]?.['punjabi'] || englishName;
        const nameOdia = VOICE_NAMES[voiceLower]?.['odia'] || englishName;
        const nameAssamese = VOICE_NAMES[voiceLower]?.['assamese'] || englishName;

        const hindiText = isMale
            ? `नमस्ते जी, मैं ${nameHindi} बोल रहा हूं प्रिसाइज इंजीनियर्स इंदौर से। आपकी क्या मदद कर सकता हूं?`
            : `नमस्ते जी, मैं ${nameHindi} बोल रही हूं प्रिसाइज इंजीनियर्स इंदौर से। आपकी क्या मदद कर सकती हूं?`;

        const marathiText = isMale
            ? `नमस्ते जी, मी प्रिसाइज इंजीनियर्स इंदूरमधून ${nameMarathi} बोलत आहे. मी आपली काय मदत करू शकतो?`
            : `नमस्ते जी, मी प्रिसाइज इंजीनियर्स इंदूरमधून ${nameMarathi} बोलत आहे. मी आपली काय मदत करू शकते?`;

        const gujaratiText = isMale
            ? `નમસ્તે જી, હું ઇન્દોરની પ્રિસાઇઝ એન્જિનિયર્સમાંથી ${nameGujarati} બોલી રહ્યો છું. હું તમારી શું મદદ કરી શકું?`
            : `નમસ્તે જી, હું ઇન્દોરની પ્રિસાઇઝ એન્જિનિયર્સમાંથી ${nameGujarati} બોલી રહી છું. હું તમારી શું મદદ કરી શકું?`;

        const punjabiText = isMale
            ? `ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ ਜੀ, ਮੈਂ ਇੰਦੌਰ ਦੇ ਪ੍ਰਿਸਾਈਜ਼ ਇੰਜੀਨੀਅਰਜ਼ ਤੋਂ ${namePunjabi} ਬੋਲ ਰਿਹਾ ਹਾਂ। ਮੈਂ ਤੁਹਾਡੀ ਕੀ ਮਦਦ ਕਰ ਸਕਦਾ ਹਾਂ?`
            : `ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ ਜੀ, ਮੈਂ ਇੰਦੌਰ ਦੇ ਪ੍ਰਿਸਾਈਜ਼ ਇੰਜੀਨੀਅਰਜ਼ ਤੋਂ ${namePunjabi} ਬੋਲ ਰਹੀ ਹਾਂ। ਮੈਂ ਤੁਹਾਡੀ ਕੀ ਮਦਦ ਕਰ ਸਕਦੀ ਹਾਂ?`;

        const greetings: Record<string, { text: string; langCode: string }> = {
            'hindi': { text: hindiText, langCode: 'hi-IN' },
            'english': { text: `Hello, this is ${nameEnglish} from Precise Engineers, Indore. How may I help you today?`, langCode: 'en-IN' },
            'tamil': { text: `வணக்கம், நான் பிரிசைஸ் இன்ஜினியர்ஸ் இந்தூரிலிருந்து ${nameTamil} பேசுகிறேன். உங்களுக்கு எப்படி உதவ முடியும்?`, langCode: 'ta-IN' },
            'telugu': { text: `నమస్తే అండి, నేను ఇండోర్ లోని ప్రిసైజ్ ఇంజనీర్స్ నుండి ${nameTelugu} మాట్లాడుతున్నాను. నేను మీకు ఎలా సహాయపడగలను?`, langCode: 'te-IN' },
            'kannada': { text: `ನಮಸ್ತೆ, ನಾನು ಇಂದೋರ್‌ನ ಪ್ರಿಸೈಸ್ ಇಂಜಿನಿಯರ್ಸ್‌ನಿಂದ ${nameKannada} ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ. ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?`, langCode: 'kn-IN' },
            'bengali': { text: `নমস্কার, আমি ইন্দোরের প্রিসাইজ ইঞ্জিনিয়ার্স থেকে ${nameBengali} বলছি। আমি আপনাকে কীভাবে সাহায্য করতে পারি?`, langCode: 'bn-IN' },
            'malayalam': { text: `നമസ്കാരം, ഞാൻ ഇൻഡോറിലെ പ്രിസൈസ് എഞ്ചിനീയേഴ്സിൽ നിന്ന് ${nameMalayalam} സംസാരിക്കുന്നു. ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കണം?`, langCode: 'ml-IN' },
            'marathi': { text: marathiText, langCode: 'mr-IN' },
            'gujarati': { text: gujaratiText, langCode: 'gu-IN' },
            'punjabi': { text: punjabiText, langCode: 'pa-IN' },
            'odia': { text: `ନମସ୍କାର, ମୁଁ ଇନ୍ଦୋରର ପ୍ରିସାଇଜ୍ ଇଞ୍ջିନିୟର୍ସରୁ ${nameOdia} କହୁଛି | ମୁଁ ଆପଣଙ୍କୁ କିପରି ସାହାଯ୍ୟ କରିପାରିବି?`, langCode: 'od-IN' },
            'assamese': { text: `নমস্কাৰ, মই ইন্দোৰৰ প্ৰিসাইজ ইঞ্জিনিয়াৰ্সৰ পৰা ${nameAssamese} কৈছোঁ। মই আপোনাক কিদৰে সহায় কৰিব পাৰোঁ?`, langCode: 'as-IN' }
        };
        
        const selected = (this.language && greetings[this.language.toLowerCase()]) || greetings['hindi'];
        this.detectedLang = selected.langCode;
        this.socket.emit('languageDetected', { 
            languageCode: this.detectedLang, 
            languageName: getLanguageName(this.detectedLang) 
        });
        if (!this.textOnly) {
            await this.speak(selected.text, selected.langCode, currentTurn);
        }
        this.socket.emit('sarvamReady');
    }

    async processAudio(data: Buffer): Promise<void> {
        if (!this.isActive) return;
        // Cap the audio buffer at ~15 seconds of 16kHz 16-bit mono PCM
        const MAX_AUDIO_BYTES = 16000 * 2 * 15;
        this.audioBuffer.push(data);
        let total = 0;
        for (const b of this.audioBuffer) total += b.length;
        while (total > MAX_AUDIO_BYTES && this.audioBuffer.length > 1) {
            this.audioBuffer.shift();
            total -= this.audioBuffer[0] ? this.audioBuffer[0].length : 0;
        }
    }

    async endAudioTurn(): Promise<void> {
        console.log('[Pipeline] endAudioTurn triggered. Active:', this.isActive, 'Buffer chunks:', this.audioBuffer.length);
        if (!this.isActive || !this.audioBuffer.length) return;
        this.turnCounter++;
        const currentTurn = this.turnCounter;
        const rawAudio = Buffer.concat(this.audioBuffer);
        this.audioBuffer = [];
        console.log('[Pipeline] Concatenated raw audio size:', rawAudio.length, 'bytes');
        const audio = addWavHeader(rawAudio, 16000);
        console.log('[Pipeline] Added WAV header. Total audio size:', audio.length, 'bytes');
        try {
            console.log('[Pipeline] Sending request to Sarvam speechToText.transcribe with language_code: unknown...');
            const stt: any = await (this.sarvam.speechToText as any).transcribe({
                file: new Blob([audio], { type: 'audio/wav' }),
                model: process.env.SARVAM_STT_MODEL || 'saaras:v3',
                language_code: 'unknown',
            });
            const sttData: any = stt?.data || stt;
            console.log('[Pipeline] Sarvam STT response:', JSON.stringify(sttData));
            const text: string = sttData?.transcript || sttData?.text || '';
            if (!text.trim()) {
                console.log('[Pipeline] STT transcript is empty, returning early.');
                return;
            }
            
            const detectedCode = sttData?.language_code || '';
            if (detectedCode) {
                const targetLangName = getLanguageName(detectedCode);
                const oldCode = this.detectedLang;
                this.detectedLang = detectedCode;
                this.language = targetLangName.toLowerCase();
                
                if (oldCode.toLowerCase() !== this.detectedLang.toLowerCase()) {
                    console.log(`[Pipeline] STT dynamically detected language switch: ${detectedCode} (${targetLangName})`);
                    this.socket.emit('languageDetected', { 
                        languageCode: this.detectedLang, 
                        languageName: targetLangName 
                    });
                }
            }
            
            console.log(`[Pipeline] (${this.detectedLang}): ${text}`);
            this.socket.emit('textOutput', { role: 'user', content: text });
            const reply = await this.llm(text, currentTurn);
            if (!reply) return;
            await this.speak(reply, this.detectedLang, currentTurn);
        } catch (error) {
            console.error('[Sarvam] STT/pipeline error:', error);
            this.socket.emit('error', { message: 'Sarvam processing failed', details: String(error) });
        }
    }

    async handleTextInput(text: string): Promise<void> {
        console.log('[Pipeline] handleTextInput triggered:', text);
        if (!this.isActive) return;
        this.turnCounter++;
        const currentTurn = this.turnCounter;
        try {
            this.socket.emit('textOutput', { role: 'user', content: text });
            const reply = await this.llm(text, currentTurn);
            if (!reply) {
                this.socket.emit('sarvamDone');
                return;
            }
            if (this.textOnly) {
                // Text-to-text mode: no TTS, emit the reply as text only
                this.socket.emit('textOutput', { role: 'assistant', content: reply });
                this.socket.emit('contentEnd', { type: 'TEXT' });
                this.socket.emit('sarvamDone');
                return;
            }
            await this.speak(reply, this.detectedLang, currentTurn);
        } catch (error) {
            console.error('[Sarvam] Text pipeline error:', error);
            this.socket.emit('error', { message: 'Sarvam text processing failed', details: String(error) });
        }
    }

    async updateConfig(data: { 
        language?: string; 
        systemPrompt?: string; 
        voiceId?: string; 
        temperature?: number; 
        topP?: number; 
        maxTokens?: number;
        enabledTools?: string[];
        outputSampleRate?: number;
    }): Promise<void> {
        console.log('[Pipeline] updateConfig triggered:', data);
        if (data.systemPrompt !== undefined) {
            this.systemPrompt = data.systemPrompt;
        }
        if (data.voiceId !== undefined) {
            this.voiceId = data.voiceId;
        }
        if (data.language !== undefined) {
            this.language = data.language;
            const languageCodes: Record<string, string> = {
                'hindi': 'hi-IN', 'english': 'en-IN', 'tamil': 'ta-IN', 'telugu': 'te-IN',
                'kannada': 'kn-IN', 'bengali': 'bn-IN', 'malayalam': 'ml-IN', 'marathi': 'mr-IN',
                'gujarati': 'gu-IN', 'punjabi': 'pa-IN', 'odia': 'od-IN', 'assamese': 'as-IN'
            };
            const code = languageCodes[data.language.toLowerCase()];
            if (code) {
                const oldCode = this.detectedLang;
                this.detectedLang = code;
                if (oldCode.toLowerCase() !== code.toLowerCase()) {
                    this.socket.emit('languageDetected', { 
                        languageCode: this.detectedLang, 
                        languageName: getLanguageName(this.detectedLang) 
                    });
                }
            }
        }
        if (data.temperature !== undefined) {
            this.temperature = data.temperature;
        }
        if (data.topP !== undefined) {
            this.topP = data.topP;
        }
        if (data.maxTokens !== undefined) {
            this.maxTokens = data.maxTokens;
        }
        if (data.enabledTools !== undefined) {
            this.enabledTools = data.enabledTools;
        }
        if (data.outputSampleRate !== undefined && [8000, 16000, 22050, 24000].includes(data.outputSampleRate)) {
            this.speechSampleRate = data.outputSampleRate;
        }
    }

    private async llm(text: string, turnId: number): Promise<string> {
        this.history.push({ role: 'user', content: [{ text }] });
        
        // Token-bounded memory management: cap estimated history size (rough ~4 chars/token).
        // Keeps the last MAX_HISTORY_TOKENS of conversation to bound cost per call.
        const MAX_HISTORY_TOKENS = 8000;
        let histTokens = 0;
        for (let i = this.history.length - 1; i >= 0; i--) {
            const msg = this.history[i];
            let size = 0;
            const content: any = msg.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block?.text) size += block.text.length;
                    else if (block?.toolResult?.content) {
                        for (const c of block.toolResult.content) if (c?.text) size += c.text.length;
                    }
                }
            } else if (typeof content === 'string') {
                size += content.length;
            }
            histTokens += size / 4;
            if (histTokens > MAX_HISTORY_TOKENS) {
                this.history = this.history.slice(i);
                break;
            }
        }
        
        let prompt = getProcessedSystemPrompt(this.systemPrompt, this.voiceId);
        prompt += `\n\n**CRITICAL RESPONSE FORMAT RULE (MANDATORY)**:
You MUST prepend every single response you generate with the appropriate AWS/ISO language code in square brackets, indicating the language you are replying in. Supported codes:
- English: \`[en-IN]\`
- Hindi: \`[hi-IN]\`
- Tamil: \`[ta-IN]\`
- Telugu: \`[te-IN]\`
- Kannada: \`[kn-IN]\`
- Bengali: \`[bn-IN]\`
- Malayalam: \`[ml-IN]\`
- Marathi: \`[mr-IN]\`
- Gujarati: \`[gu-IN]\`
- Punjabi: \`[pa-IN]\`
- Odia: \`[od-IN]\`
- Assamese: \`[as-IN]\`

Example outputs:
- If replying in Hindi: \`[hi-IN] नमस्ते जी, मैं...\`
- If replying in Tamil: \`[ta-IN] வணக்கம், நான்...\`

Do NOT output any other text or formatting before this tag.
Do NOT append English translations or repeat yourself in other languages. Speak ONLY in the target language.
You MUST reply in the same language that the user spoke in (e.g. if user speaks Marathi, reply in Marathi; if they speak Tamil, reply in Tamil).`;
        const isKBEnabled = this.enabledTools.includes('search_knowledge_base');
        
        const tools = isKBEnabled ? [
            {
                toolSpec: {
                    name: 'search_knowledge_base',
                    description: 'Call this tool to search the knowledge base for product specifications, recommendations, models, pricing, availability, and comparisons.',
                    inputSchema: {
                        json: {
                            type: 'object',
                            properties: {
                                query: {
                                    type: 'string',
                                    description: 'The search query to retrieve product details or recommendations'
                                }
                            },
                            required: ['query']
                        }
                    }
                }
            }
        ] : [];
        
        let loopCount = 0;
        const maxLoops = 2; // user turn + at most one tool-use round-trip
        
        while (loopCount < maxLoops) {
            if (this.turnCounter !== turnId || !this.isActive) return '';
            loopCount++;
            
            const params: any = {
                modelId: process.env.LLM_MODEL || 'apac.amazon.nova-pro-v1:0',
                system: [{ text: prompt }],
                messages: this.history,
                inferenceConfig: { 
                    maxTokens: this.maxTokens, 
                    temperature: this.temperature,
                    topP: this.topP
                }
            };
            
            if (tools.length > 0) {
                params.toolConfig = { tools };
            }
            
            if (this.turnCounter !== turnId || !this.isActive) return '';
            let res: any;
            try {
                res = await this.bedrock.send(new ConverseCommand(params));
            } catch (bedrockErr: any) {
                if (this.turnCounter !== turnId || !this.isActive) return '';
                console.error('[Pipeline] Bedrock LLM failed, falling back to OpenAI:', bedrockErr?.name || bedrockErr, bedrockErr?.message || '');
                return await this.llmOpenAI(text, prompt, turnId);
            }
            if (this.turnCounter !== turnId || !this.isActive) return '';
            
            const stopReason = res.stopReason;
            const outputMessage = res.output?.message;
            if (!outputMessage) {
                throw new Error('No message output from Bedrock');
            }
            
            // Push output message to history
            this.history.push({
                role: outputMessage.role as 'user' | 'assistant',
                content: outputMessage.content
            });
            
            if (stopReason === 'tool_use') {
                // Find tool use block
                const toolUseBlock = outputMessage.content?.find(c => (c as any).toolUse);
                if (toolUseBlock?.toolUse) {
                    const { name, toolUseId, input } = toolUseBlock.toolUse;
                    if (name === 'search_knowledge_base') {
                        const searchQuery = (input as any).query || text;
                        console.log('[Pipeline] NATIVE ToolUse triggered:', toolUseId, 'for query:', searchQuery);
                        
                        const startTime = Date.now();
                        this.socket.emit('toolUse', {
                            toolUseId,
                            toolName: 'search_knowledge_base',
                            content: JSON.stringify({ query: searchQuery })
                        });
                        
                        let resultText = 'No results found.';
                        try {
                            if (this.turnCounter !== turnId || !this.isActive) return '';
                            resultText = await this.searchKnowledgeBase(searchQuery);
                        } catch (e) {
                            console.error('[Pipeline] Native KB error:', e);
                            resultText = 'Error calling Knowledge Base: ' + String(e);
                        }
                        this.rememberKB(searchQuery, resultText);
                        
                        const duration = Date.now() - startTime;
                        this.socket.emit('toolResult', {
                            toolUseId,
                            result: JSON.stringify({ result: resultText }),
                            executionTimeMs: duration
                        });
                        
                        // Push toolResult message to history
                        this.history.push({
                            role: 'user',
                            content: [
                                {
                                    toolResult: {
                                        toolUseId,
                                        content: [{ text: resultText }],
                                        status: 'success'
                                    }
                                }
                            ]
                        });
                        
                        // Continue loop to send tool result to LLM
                        continue;
                    }
                }
            }
            
            // If we reached here, it's a normal text output (or final output after tool result)
            const textBlock = outputMessage.content?.find(c => (c as any).text);
            return this.processReply(textBlock?.text || '');
        }
        
        return '';
    }

    private async searchKnowledgeBase(query: string): Promise<string> {
        const kb = await this.bedrockAgent.send(new RetrieveAndGenerateCommand({
            input: { text: query },
            retrieveAndGenerateConfiguration: { type: 'KNOWLEDGE_BASE', knowledgeBaseConfiguration: {
                knowledgeBaseId: process.env.KB_KNOWLEDGE_BASE_ID || '', modelArn: process.env.KB_MODEL_ARN || '',
                retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: 3 } }
            }}
        }));
        let resultText = kb.output?.text || 'No results found.';
        if (resultText.length > KB_RESULT_MAX_CHARS) {
            resultText = resultText.slice(0, KB_RESULT_MAX_CHARS);
        }
        return resultText;
    }

    private processReply(rawReply: string): string {
        let reply = rawReply.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

        const langMatch = reply.trim().match(/^\[([a-zA-Z]{2}-[a-zA-Z]{2})\]\s*(.*)$/s);
        if (langMatch) {
            const detectedCode = langMatch[1];
            reply = langMatch[2];

            const targetLangName = getLanguageName(detectedCode);
            const oldCode = this.detectedLang;
            this.detectedLang = detectedCode;
            this.language = targetLangName.toLowerCase();

            if (oldCode.toLowerCase() !== this.detectedLang.toLowerCase()) {
                console.log(`[Pipeline] LLM dynamic language switch: ${detectedCode} (${targetLangName})`);
                this.socket.emit('languageDetected', {
                    languageCode: this.detectedLang,
                    languageName: targetLangName
                });
            }
        }

        return reply
            .replace(/`?search_knowledge_base\(.*?\)`?/gi, '')
            .replace(/[\*`\s]*(?:tool|knowledge|search|calls|calling)(?: |-|_)?(?:calling|call|output|result|base|knowledge_base|search_knowledge_base)?[\*`\s:-]*/gi, '')
            .replace(/\((?:[^)]*?(?:मानले|समझा|assuming|based on|derived from|tool|result|knowledge|base|साधन|निकाल|उत्तर|माहिती|information|टूल|परिणाम|जानकारी|आधार)[^)]*?)\)/gi, '')
            .replace(/[^.!?]*?(?:let me check|look up|please wait|hold on|give me a moment|thank you for waiting|details I have found|here are the details|information I found|calls search_knowledge_base)[^.!?]*?(?:\.|\!|\?|$)/gi, '')
            .replace(/[^.!?।]*?(?:खोज रहा|ढूंढ रहा|चेक कर|जानकारी लेता|प्रतीक्षा करें|इंतजार करें|रुकें)[^.!?।]*?(?:\.|\!|\?।|$)/gi, '')
            .replace(/[^.!?।]*?(?:शोधत आहे|शोध घेत आहे|चेक करतो|माहिती मिळवतो|प्रतीक्षा करा|वेળ थांबा|किंचित प्रतीक्षा|उपलब्धता तपासत|वेळ द्या)[^.!?।]*?(?:\.|\!|\?।|$)/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private historyEntryText(msg: any): string {
        const content: any = msg?.content;
        let txt = '';
        if (Array.isArray(content)) {
            for (const block of content) {
                if (block?.text) {
                    txt += block.text;
                } else if (block?.toolResult?.content) {
                    for (const c of block.toolResult.content) {
                        if (c?.text) txt += c.text;
                    }
                }
            }
        } else if (typeof content === 'string') {
            txt += content;
        }
        return txt;
    }

    private rememberKB(query: string, resultText: string): void {
        this.recentKBQueries.push(query);
        if (this.recentKBQueries.length > MEMORY_QUERY_LIMIT) this.recentKBQueries.shift();
        if (resultText && resultText !== 'No results found.' && !resultText.startsWith('Error') && !resultText.startsWith('Product catalog is temporarily unavailable.')) {
            this.lastKBResultText = resultText;
        }
    }

    private fallbackApology(): string {
        const apologies: Record<string, string> = {
            'hi-IN': 'क्षमा करें, सिस्टम व्यस्त है। कृपया थोड़ी देर में फिर से बताइए।',
            'mr-IN': 'क्षमस्व, सिस्टम व्यस्त आहे. कृपया थोड्या वेळाने पुन्हा सांगा.',
            'en-IN': 'Sorry, the system is busy. Please try again in a moment.',
            'ta-IN': 'மன்னிக்கவும், அமைப்பு பணிமிகுதியில் உள்ளது. சற்று நேரம் கழித்து மீண்டும் சொல்லுங்கள்.',
            'te-IN': 'క్షమించండి, సిస్టమ్ బిజీగా ఉంది. కొంచెం తర్వాత మళ్లీ చెప్పండి.',
            'kn-IN': 'ಕ್ಷಮಿಸಿ, ಸಿಸ್ಟಮ್ ಕಾರ್ಯನಿರತವಾಗಿದೆ. ಸ್ವಲ್ಪ ಹೊತ್ತಿನ ನಂತರ ಮತ್ತೆ ಹೇಳಿ.',
            'bn-IN': 'দুঃখিত, সিস্টেম ব্যস্ত আছে। একটু পরে আবার বলুন।',
            'ml-IN': 'ക്ഷമിക്കണം, സിസ്റ്റം തിരക്കിലാണ്. അല്പനേരം കഴിഞ്ഞ് വീണ്ടും പറയൂ.',
            'gu-IN': 'માફ કરશો, સિસ્ટમ વ્યસ્ત છે. થોડી વાર પછી ફરી કહો.',
            'pa-IN': 'ਮਾਫ਼ ਕਰਨਾ, ਸਿਸਟਮ ਰੁੱਝਿਆ ਹੋਇਆ ਹੈ। ਥੋੜ੍ਹੀ ਦੇਰ ਬਾਅਦ ਦੁਬਾਰਾ ਦੱਸੋ।',
            'od-IN': 'କ୍ଷମା କରନ୍ତୁ, ସିଷ୍ଟମ୍ ବ୍ୟସ୍ତ ଅଛି। ଏଟା ପରେ ପୁଣି କୁହନ୍ତୁ।',
            'as-IN': 'ক্ষমা কৰিব, চিষ্টেম ব্যস্ত হৈ আছে। অলপ পাছত আকৌ কওক।'
        };
        return apologies[this.detectedLang] || apologies['en-IN'];
    }

    private async llmOpenAI(text: string, systemPromptText: string, turnId: number): Promise<string> {
        const apiKey = process.env.OPENAI_API_KEY || '';
        if (!apiKey) {
            throw new Error('Bedrock failed and OPENAI_API_KEY is not configured for fallback');
        }

        const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
        const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

        // Deterministic conversation memory (no extra LLM calls, fully traceable):
        // verified facts captured in code at KB lookup time + recent turns kept verbatim.
        const memoryLines: string[] = [];
        if (this.detectedLang) memoryLines.push(`User language: ${this.detectedLang}`);
        if (this.recentKBQueries.length) {
            memoryLines.push('Recent product queries from the user:');
            for (const q of this.recentKBQueries) memoryLines.push(`- ${q}`);
        }
        if (this.lastKBResultText) {
            memoryLines.push('Latest verified catalog information:\n' + this.lastKBResultText);
        }
        const memoryBlock = memoryLines.length
            ? '\n\n[CONVERSATION MEMORY - verified facts from this session]\n' + memoryLines.join('\n')
            : '';
        console.log('[Pipeline] Conversation memory:', JSON.stringify({
            language: this.detectedLang,
            kbQueries: this.recentKBQueries,
            hasCatalogResult: !!this.lastKBResultText
        }));

        const MAX_REQUEST_CHARS = 11000; // ~2.7K tokens including system prompt and memory
        let keepFrom = Math.max(0, this.history.length - 1); // always keep the latest turn verbatim
        let totalChars = systemPromptText.length + memoryBlock.length
            + this.historyEntryText(this.history[this.history.length - 1] || {}).length;
        for (let i = this.history.length - 2; i >= 0; i--) {
            const len = this.historyEntryText(this.history[i]).length;
            if (totalChars + len > MAX_REQUEST_CHARS) break;
            totalChars += len;
            keepFrom = i;
        }

        const messages: any[] = [{ role: 'system', content: systemPromptText + memoryBlock }];
        for (let i = keepFrom; i < this.history.length; i++) {
            const msg = this.history[i];
            const msgText = this.historyEntryText(msg);
            if (msgText.trim()) {
                messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msgText });
            }
        }

        const tools = this.enabledTools.includes('search_knowledge_base') ? [
            {
                type: 'function',
                function: {
                    name: 'search_knowledge_base',
                    description: 'Search product specifications, recommendations, models, pricing, availability, and comparisons.',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'The search query to retrieve product details or recommendations' }
                        },
                        required: ['query']
                    }
                }
            }
        ] : undefined;

        for (let loopCount = 0; loopCount < 2; loopCount++) {
            if (this.turnCounter !== turnId || !this.isActive) return '';

            const body: any = {
                model,
                messages,
                temperature: this.temperature,
                top_p: this.topP,
                max_tokens: this.maxTokens
            };
            // Reasoning models (e.g. Groq gpt-oss): minimize thinking time for voice latency
            if (model.includes('gpt-oss')) {
                body.reasoning_effort = 'low';
            }
            if (tools) body.tools = tools;

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
            let responseJson: any;
            try {
                let response: any = null;
                for (let attempt = 0; attempt < 2; attempt++) {
                    if (this.turnCounter !== turnId || !this.isActive) return '';
                    response = await (globalThis as any).fetch(`${baseUrl}/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${apiKey}`
                        },
                        body: JSON.stringify(body),
                        signal: controller.signal
                    });
                    if (response.ok) break;
                    if (response.status === 429 && attempt === 0) {
                        const retryAfterSec = parseFloat(response.headers.get('retry-after') || '') || 0;
                        const waitMs = Math.min(Math.max(retryAfterSec * 1000, 3000), 15000);
                        console.log(`[Pipeline] Fallback provider rate limited, retrying in ${Math.round(waitMs / 1000)}s`);
                        await new Promise(r => setTimeout(r, waitMs));
                        continue;
                    }
                    break;
                }
                if (!response || !response.ok) {
                    const errorText = response ? await response.text().catch(() => '') : 'no response';
                    console.error('[Pipeline] Fallback provider failed:', response?.status, errorText.slice(0, 200));
                    return this.fallbackApology();
                }
                responseJson = await response.json();
            } finally {
                clearTimeout(timer);
            }

            const message = responseJson?.choices?.[0]?.message;
            if (!message) {
                throw new Error('No message output from OpenAI');
            }

            if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
                messages.push({ role: 'assistant', content: message.content || '', tool_calls: message.tool_calls });
                for (const toolCall of message.tool_calls) {
                    if (toolCall?.function?.name !== 'search_knowledge_base') continue;
                    let searchQuery = text;
                    try {
                        searchQuery = JSON.parse(toolCall.function.arguments || '{}')?.query || text;
                    } catch {
                        searchQuery = text;
                    }

                    console.log('[Pipeline] OpenAI fallback ToolUse triggered:', toolCall.id, 'for query:', searchQuery);
                    const startTime = Date.now();
                    this.socket.emit('toolUse', {
                        toolUseId: toolCall.id,
                        toolName: 'search_knowledge_base',
                        content: JSON.stringify({ query: searchQuery })
                    });

                    let resultText = 'No results found.';
                    try {
                        if (this.turnCounter !== turnId || !this.isActive) return '';
                        resultText = await this.searchKnowledgeBase(searchQuery);
                    } catch (e) {
                        console.error('[Pipeline] OpenAI fallback KB error:', e);
                        resultText = 'Product catalog is temporarily unavailable.';
                    }
                    this.rememberKB(searchQuery, resultText);

                    this.socket.emit('toolResult', {
                        toolUseId: toolCall.id,
                        result: JSON.stringify({ result: resultText }),
                        executionTimeMs: Date.now() - startTime
                    });
                    messages.push({ role: 'tool', tool_call_id: toolCall.id, content: resultText });
                }
                continue;
            }

            const rawReply = message.content || '';
            if (rawReply.trim()) {
                this.history.push({ role: 'assistant', content: [{ text: rawReply }] });
            }
            return this.processReply(rawReply);
        }

        return '';
    }

    private async speak(text: string, lang: string, turnId: number): Promise<void> {
        try {
            // Split into smaller chunks (150 chars max) to align text & voice streaming speed
            const chunks = splitTextIntoChunks(text, TTS_CHUNK_SIZE);
            if (chunks.length === 0) {
                if (this.turnCounter === turnId) {
                    this.socket.emit('sarvamDone');
                }
                return;
            }
            
            console.log(`[Pipeline] Speak chunks count: ${chunks.length} for language: ${lang}`);
            
            const speaker = SDK_SPEAKER_MAP[this.voiceId?.toLowerCase()] || 'anushka';
            
            // Map chunks to API calls to pre-load/fetch in parallel for zero latency gap
            const convertPromises = chunks.map(chunk => 
                (this.sarvam.textToSpeech as any).convert({
                    text: chunk,
                    target_language_code: lang,
                    speaker,
                    model: process.env.SARVAM_TTS_MODEL || 'bulbul:v2',
                    output_audio_codec: 'linear16',
                    speech_sample_rate: this.speechSampleRate,
                })
            );
            
            // Process and stream each chunk sequentially in sync with speech duration
            for (let i = 0; i < chunks.length; i++) {
                if (!this.isActive || this.turnCounter !== turnId) break;
                
                const chunk = chunks[i];
                const res: any = await convertPromises[i];
                
                if (this.turnCounter !== turnId) break;
                
                const resData: any = res?.data || res;
                const audios: string[] = resData?.audios || [];
                if (audios[0] && this.isActive) {
                    const buf = Buffer.from(audios[0], 'base64');
                    // durationMs = sampleCount / sampleRate * 1000 = (buf.length / 2) / sampleRate * 1000
                    const durationMs = (buf.length / 2) / this.speechSampleRate * 1000;
                    
                    // Emit text chunk exactly as speech starts
                    this.socket.emit('textOutput', { role: 'assistant', content: chunk });
                    
                    // Emit audio content chunks
                    for (let j = 0; j < buf.length; j += 4096) {
                        if (!this.isActive || this.turnCounter !== turnId) break;
                        this.socket.emit('audioOutput', { content: buf.slice(j, j + 4096).toString('base64') });
                    }
                    
                    // Sleep for the chunk duration (minus 100ms cushion to prevent client underflow)
                    // before displaying/speaking the next chunk.
                    if (i < chunks.length - 1 && this.isActive && this.turnCounter === turnId) {
                        await new Promise(resolve => setTimeout(resolve, Math.max(0, durationMs - 100)));
                    }
                }
            }
            
            if (this.isActive && this.turnCounter === turnId) {
                this.socket.emit('contentEnd', { type: 'AUDIO' });
                this.socket.emit('sarvamDone');
            }
        } catch (error) {
            console.error('[Pipeline] TTS speak error:', error);
            if (this.turnCounter === turnId) {
                this.socket.emit('error', { message: 'TTS conversion failed', details: String(error) });
                this.socket.emit('sarvamDone');
            }
        }
    }

    interrupt(): void {
        this.turnCounter++;
        this.audioBuffer = [];
        console.log(`[Pipeline] Interruption triggered. turnCounter is now: ${this.turnCounter}. Cleared audio buffer.`);
    }

    stop(): void {
        this.isActive = false;
        this.turnCounter++;
        this.audioBuffer = [];
        this.history = [];
    }
}
