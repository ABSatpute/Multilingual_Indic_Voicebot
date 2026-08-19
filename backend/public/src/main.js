import { AudioPlayer } from './lib/play/AudioPlayer.js';
import { ChatHistoryManager } from "./lib/util/ChatHistoryManager.js";

// Connect to the server
// Clear stale config
const _saved = localStorage.getItem('novaSonicConfig'); if (_saved) { try { const _p = JSON.parse(_saved); if (_p.awsRegion === 'ap-northeast-1') localStorage.removeItem('novaSonicConfig'); } catch(e) {} }
const socket = io({
    transports: ['websocket', 'polling']
});
function isSarvamLanguage(lang) { return true; }

// DOM elements
const voiceBtn = document.getElementById('voice-btn');
const micIcon = voiceBtn.querySelector('.mic-icon');
const stopIcon = voiceBtn.querySelector('.stop-icon');
const chatContainer = document.getElementById('chat-container');
const voiceHint = document.querySelector('.voice-hint');
const waveformCanvas = document.getElementById('waveform-canvas');
const ctx = waveformCanvas.getContext('2d');
const ringCanvas = document.getElementById('ring-canvas');
const ringCtx = ringCanvas.getContext('2d');
const themeToggle = document.getElementById('theme-toggle');

// Settings elements
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsClose = document.getElementById('settings-close');
const systemPromptTextarea = document.getElementById('system-prompt');
const temperatureSlider = document.getElementById('temperature');
const temperatureValue = document.getElementById('temperature-value');
const topPSlider = document.getElementById('top-p');
const topPValue = document.getElementById('top-p-value');
const maxTokensSlider = document.getElementById('max-tokens');
const maxTokensValue = document.getElementById('max-tokens-value');
const audioBufferSlider = document.getElementById('audio-buffer');
const audioBufferValue = document.getElementById('audio-buffer-value');
const vadThresholdSlider = document.getElementById('vad-threshold');
const vadThresholdValue = document.getElementById('vad-threshold-value');
const bargeInThresholdSlider = document.getElementById('barge-in-threshold');
const bargeInThresholdValue = document.getElementById('barge-in-threshold-value');
const enableBargeInCheckbox = document.getElementById('enable-barge-in');

// Custom dropdown elements
const customSelects = document.querySelectorAll('.custom-select');

// Theme
let isDarkMode = true;

// Chat history management
let chat = { history: [] };
const chatRef = { current: chat };
const chatHistoryManager = ChatHistoryManager.getInstance(
    chatRef,
    (newChat) => {
        chat = { ...newChat };
        chatRef.current = chat;
        updateChatUI();
    }
);

// Audio processing variables
let audioContext;
let audioStream;
let isStreaming = false;
let isInitializing = false;
let currentKBIndicator = null;
let currentTurnLanguage = null;
let isAssistantSpeaking = false;
let bargeInCooldownEndTime = 0;
let assistantSpeakStartTime = 0;
let isWaitingForResponse = false;
let noiseFloor = 0.02; // Initial guess for quiet room
let consecutiveSpeechFrames = 0;
let processor;
let sourceNode;
let waitingForAssistantResponse = false;
let waitingForUserTranscription = false;
let pendingToolUses = []; // Array to support multiple tools
let userThinkingIndicator = null;
let assistantThinkingIndicator = null;
let transcriptionReceived = false;
let displayAssistantText = false;
let role;
const audioPlayer = new AudioPlayer();
let sessionInitialized = false;
let manualDisconnect = false;

// Waveform animation
let animationId = null;
let audioLevel = 0;
let targetAudioLevel = 0;
let assistantAudioLevel = 0;
let targetAssistantAudioLevel = 0;
let hueRotation = 0;
let isAnimating = false;

// Audio playback duration tracking
let speechStartTime = 0;
let totalAudioDuration = 0;
let audioFadeTimer = null;

// Ring fade out state
let ringFadeAlpha = 0;
let isRingFadingOut = false;

let samplingRatio = 1;
const TARGET_SAMPLE_RATE = 16000;
const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');

// Configuration state (defaults loaded from server)
let config = {
    systemPrompt: '',
    voiceId: 'priya',
    responseTiming: 'medium',
    outputSampleRate: 24000,
    audioBufferMs: 200,
    temperature: 0.4,
    topP: 0.9,
    maxTokens: 2048,
    enabledTools: [],
    language: 'hindi',
    vadThreshold: 0.025,
    bargeInThreshold: 0.150,
    enableBargeIn: true
};

// Available tools (loaded from server)
let availableTools = [];

// Session timeout management (Nova Sonic has 8-minute max connection)
const SESSION_TIMEOUT_MS = 7 * 60 * 1000; // 7 minutes (warn before 8-min limit)
const SESSION_WARNING_MS = 6 * 60 * 1000; // 6 minutes (show warning)
let sessionStartTime = null;
let sessionTimeoutTimer = null;
let sessionWarningTimer = null;

function startSessionTimers() {
    clearSessionTimers();
    sessionStartTime = Date.now();
    
    // Warning timer at 6 minutes
    sessionWarningTimer = setTimeout(() => {
        showSessionWarning();
    }, SESSION_WARNING_MS);
    
    // Auto-renewal timer at 7 minutes
    sessionTimeoutTimer = setTimeout(() => {
        handleSessionTimeout();
    }, SESSION_TIMEOUT_MS);
}

function clearSessionTimers() {
    if (sessionTimeoutTimer) {
        clearTimeout(sessionTimeoutTimer);
        sessionTimeoutTimer = null;
    }
    if (sessionWarningTimer) {
        clearTimeout(sessionWarningTimer);
        sessionWarningTimer = null;
    }
    sessionStartTime = null;
}

function showSessionWarning() {
    const warningDiv = document.createElement('div');
    warningDiv.className = 'message system session-warning';
    warningDiv.id = 'session-warning';
    warningDiv.innerHTML = '<span class="warning-icon">⏱️</span> Session expiring soon. Will auto-renew...';
    chatContainer.appendChild(warningDiv);
    scrollToBottom();
}

function hideSessionWarning() {
    const warning = document.getElementById('session-warning');
    if (warning && warning.parentNode) {
        warning.parentNode.removeChild(warning);
    }
}

async function handleSessionTimeout() {
    console.log('Session timeout - auto-renewing...');
    hideSessionWarning();
    
    // Show renewal indicator
    const renewDiv = document.createElement('div');
    renewDiv.className = 'message system session-renew';
    renewDiv.innerHTML = '<span class="renew-icon">🔄</span> Renewing session...';
    chatContainer.appendChild(renewDiv);
    scrollToBottom();
    
    try {
        const wasStreaming = isStreaming;
        
        // Close current session gracefully and wait for server confirmation
        if (sessionInitialized) {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    console.log('Session close timeout, proceeding anyway');
                    resolve();
                }, 5000);
                
                socket.once('sessionClosed', () => {
                    clearTimeout(timeout);
                    console.log('Session closed confirmed by server');
                    resolve();
                });
                
                socket.emit('stopAudio');
            });
        }
        
        sessionInitialized = false;
        
        // Small delay to ensure server cleanup is complete
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Reinitialize if was streaming
        if (wasStreaming) {
            socket.emit('sarvamStart', { 
                language: config.language, 
                systemPrompt: config.systemPrompt, 
                voiceId: config.voiceId,
                temperature: config.temperature,
                topP: config.topP,
                maxTokens: config.maxTokens,
                enabledTools: config.enabledTools,
                outputSampleRate: config.outputSampleRate
            });
            renewDiv.innerHTML = '<span class="renew-icon">✓</span> Session renewed';
            renewDiv.classList.add('success');
        } else {
            renewDiv.innerHTML = '<span class="renew-icon">✓</span> Session ended';
        }
        
        // Fade out the message
        setTimeout(() => {
            renewDiv.classList.add('fade-out');
            setTimeout(() => {
                if (renewDiv.parentNode) {
                    renewDiv.parentNode.removeChild(renewDiv);
                }
            }, 500);
        }, 2000);
    } catch (error) {
        console.error('Failed to renew session:', error);
        renewDiv.innerHTML = '<span class="renew-icon">⚠️</span> Session renewal failed';
        renewDiv.classList.add('error');
    }
}

// Settings disabled state management
function setSettingsDisabled(disabled) {
    const settingsContent = document.querySelector('.settings-content');
    if (settingsContent) {
        settingsContent.classList.toggle('settings-disabled', disabled);
    }
    
    // Disable/enable all interactive elements
    customSelects.forEach(select => {
        select.classList.toggle('disabled', disabled);
    });
    
    systemPromptTextarea.disabled = disabled;
    temperatureSlider.disabled = disabled;
    temperatureValue.disabled = disabled;
    topPSlider.disabled = disabled;
    topPValue.disabled = disabled;
    maxTokensSlider.disabled = disabled;
    maxTokensValue.disabled = disabled;
    audioBufferSlider.disabled = disabled;
    audioBufferValue.disabled = disabled;
    vadThresholdSlider.disabled = disabled;
    vadThresholdValue.disabled = disabled;
    
    enableBargeInCheckbox.disabled = disabled;
    bargeInThresholdSlider.disabled = disabled || !config.enableBargeIn;
    bargeInThresholdValue.disabled = disabled || !config.enableBargeIn;
    
    // Disable/enable tools checkboxes
    setToolsDisabled(disabled);
}

// Custom dropdown initialization
function initCustomSelects() {
    customSelects.forEach(select => {
        const trigger = select.querySelector('.custom-select-trigger');
        const options = select.querySelectorAll('.custom-select-option');
        const valueDisplay = select.querySelector('.custom-select-value');
        const selectId = select.dataset.id;
        const settingItem = select.closest('.setting-item') || select.closest('.settings-section');

        // Toggle dropdown
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Don't open if disabled
            if (select.classList.contains('disabled')) return;
            
            // Close other dropdowns and reset their z-index
            customSelects.forEach(s => {
                if (s !== select) {
                    s.classList.remove('open');
                    const parentItem = s.closest('.setting-item') || s.closest('.settings-section');
                    if (parentItem) parentItem.style.zIndex = '';
                }
            });
            
            // Toggle this dropdown
            const isOpening = !select.classList.contains('open');
            select.classList.toggle('open');
            
            // Set high z-index on parent when open
            if (settingItem) {
                settingItem.style.zIndex = isOpening ? '1000' : '';
            }
        });

        // Option selection
        options.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = option.dataset.value;

                // Update visual state
                options.forEach(o => o.classList.remove('selected'));
                option.classList.add('selected');
                // Use innerHTML for voice-type to preserve icons
                if (selectId === 'voice-type') {
                    // Clone the option content to preserve icons safely
                    valueDisplay.textContent = '';
                    Array.from(option.childNodes).forEach(node => {
                        valueDisplay.appendChild(node.cloneNode(true));
                    });
                } else {
                    // For options with descriptions, only show the label
                    const label = option.querySelector('.option-label');
                    valueDisplay.textContent = label ? label.textContent.trim() : option.textContent.trim();
                }
                select.dataset.value = value;
                select.classList.remove('open');
                
                // Reset z-index
                if (settingItem) settingItem.style.zIndex = '';

                // Update config based on select id
                updateConfigFromSelect(selectId, value);
            });
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', () => {
        customSelects.forEach(select => {
            select.classList.remove('open');
            const parentItem = select.closest('.setting-item') || select.closest('.settings-section');
            if (parentItem) parentItem.style.zIndex = '';
        });
    });
}

// Prompt presets cache
const promptPresets = {};

async function loadPromptPreset(presetName) {
    if (presetName === 'custom') return;
    
    // Check cache first
    if (promptPresets[presetName]) {
        config.systemPrompt = promptPresets[presetName];
        systemPromptTextarea.value = promptPresets[presetName];
        syncSettingsToServer();
        return;
    }
    
    try {
        const response = await fetch(`/prompts/${presetName}.md`);
        if (response.ok) {
            const content = await response.text();
            promptPresets[presetName] = content;
            config.systemPrompt = content;
            systemPromptTextarea.value = content;
            syncSettingsToServer();
        }
    } catch (error) {
        console.error('Failed to load prompt preset:', error);
    }
}

function updateConfigFromSelect(selectId, value) {
    switch (selectId) {
        case 'language-select':
            config.language = value;
            break;
        case 'voice-type':
            config.voiceId = value;
            break;
        case 'response-timing':
            config.responseTiming = value;
            break;
        case 'output-sample-rate':
            config.outputSampleRate = parseInt(value, 10);
            break;
        case 'prompt-preset':
            loadPromptPreset(value);
            break;
    }
    syncSettingsToServer();
}

function setCustomSelectValue(selectId, value) {
    const select = document.querySelector(`.custom-select[data-id="${selectId}"]`);
    if (!select) return;

    const options = select.querySelectorAll('.custom-select-option');
    const valueDisplay = select.querySelector('.custom-select-value');

    options.forEach(option => {
        if (option.dataset.value === value) {
            options.forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            // Clone content for voice-type to preserve icons safely
            if (selectId === 'voice-type') {
                valueDisplay.textContent = '';
                Array.from(option.childNodes).forEach(node => {
                    valueDisplay.appendChild(node.cloneNode(true));
                });
            } else {
                // For options with descriptions, only show the label
                const label = option.querySelector('.option-label');
                valueDisplay.textContent = label ? label.textContent.trim() : option.textContent.trim();
            }
            select.dataset.value = value;
        }
    });
}

// Initialize settings UI
async function initSettings() {
    // Load saved config from localStorage
    const savedConfig = localStorage.getItem('novaSonicConfig');
    if (savedConfig) {
        config = { ...config, ...JSON.parse(savedConfig) };
    }

    // Auto-migrate old business name in saved local storage system prompt
    if (config.systemPrompt) {
        const originalPrompt = config.systemPrompt;
        config.systemPrompt = config.systemPrompt
            .replace(/JAIN SALES CORPORATION/g, 'PRECISE ENGINEERS')
            .replace(/Jain Sales Corporation/g, 'Precise Engineers')
            .replace(/Jain Sales/g, 'Precise Engineers')
            .replace(/जैन सेल्स कॉर्पोरेशन/g, 'प्रिसाइज इंजीनियर्स')
            .replace(/जैन सेल्स/g, 'प्रिसाइज इंजीनियर्स')
            .replace(/ஜெயின் சேல்ஸ் கார்ப்பரேஷன்/g, 'பிரிசைஸ் இன்ஜினியர்ஸ்')
            .replace(/ஜைன் சேல்ஸ் கார்ப்பரேஷன்/g, 'பிரிசைஸ் இன்ஜினியர்ஸ்')
            .replace(/జైన్ సేల్స్ కార్పొరేషన్/g, 'ప్రిసైజ్ ఇంజనీర్స్')
            .replace(/ಜೈನ್ ಸೇಲ್ಸ್ ಕಾರ್ಪೊರೇಶನ್/g, 'ಪ್ರಿಸೈಸ್ ಇಂಜಿನಿಯರ್ಸ್')
            .replace(/জৈন সেলস কর্পোরেশন/g, 'প্রিসাইজ ইঞ্জিনিয়ার্স')
            .replace(/ജെയിൻ സെയിൽസ് കോർപ്പറേഷൻ/g, 'പ്രിസൈസ് എഞ്ചിനീയേഴ്സ്')
            .replace(/જૈન સેલ્સ કોર્પોરેશન/g, 'પ્રિસાઇઝ એન્જિનિયર્સ')
            .replace(/ਜੈਨ ਸੇਲਜ਼ ਕਾਰਪੋਰੇਸ਼ਨ/g, 'ਪ੍ਰਿਸਾਈਜ਼ ਇੰਜੀਨੀਅਰਜ਼')
            .replace(/ଜୈନ ସେଲ୍ସ କର୍ପୋରେସନ/g, 'ପ୍ରିସਾਈଜ୍ ଇଞ୍ջିନିୟର୍ସ')
            .replace(/ଜୈନ ସେଲ୍ସ କର୍ପୋରେସନ୍/g, 'ପ୍ରିସਾਈଜ୍ ଇଞ୍ջିନିୟର୍ସ')
            .replace(/জৈন চেলছ কৰ্পোৰেচন/g, 'প্রিসাইজ ইঞ্জিনিয়ার্স');

        if (config.systemPrompt !== originalPrompt) {
            saveConfig();
        }
    }
    
    // Load default system prompt if empty
    if (!config.systemPrompt || !config.systemPrompt.trim()) {
        await loadPromptPreset('default');
    }

    // Initialize custom dropdowns
    initCustomSelects();

    // Apply config to UI
    applyConfigToUI();

    // Settings panel toggle
    settingsToggle.addEventListener('click', () => {
        settingsPanel.classList.add('open');
        settingsOverlay.classList.add('open');
    });

    const closeSettings = () => {
        settingsPanel.classList.remove('open');
        settingsOverlay.classList.remove('open');
        saveConfig();
    };

    settingsClose.addEventListener('click', closeSettings);
    settingsOverlay.addEventListener('click', closeSettings);

    // Slider sync
    setupSliderSync(temperatureSlider, temperatureValue, 'temperature');
    setupSliderSync(topPSlider, topPValue, 'topP');
    setupSliderSync(maxTokensSlider, maxTokensValue, 'maxTokens');
    setupSliderSync(audioBufferSlider, audioBufferValue, 'audioBufferMs', (value) => {
        // Update the AudioPlayer's initial buffer when changed
        if (audioPlayer.initialized) {
            audioPlayer.setInitialBufferMs(value);
        }
    });
    setupSliderSync(vadThresholdSlider, vadThresholdValue, 'vadThreshold');
    setupSliderSync(bargeInThresholdSlider, bargeInThresholdValue, 'bargeInThreshold');

    enableBargeInCheckbox.addEventListener('change', (e) => {
        config.enableBargeIn = e.target.checked;
        bargeInThresholdSlider.disabled = !config.enableBargeIn;
        bargeInThresholdValue.disabled = !config.enableBargeIn;
        syncSettingsToServer();
    });

    // Textarea handler - switch to Custom when user edits
    systemPromptTextarea.addEventListener('input', (e) => {
        config.systemPrompt = e.target.value;
        // Switch preset dropdown to "Custom" when user manually edits
        setCustomSelectValue('prompt-preset', 'custom');
        syncSettingsToServer();
    });
    
    // Load available tools
    loadAvailableTools();
}

function setupSliderSync(slider, input, configKey, onChange = null) {
    slider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        input.value = value;
        config[configKey] = value;
        updateSliderTrack(slider);
        if (onChange) onChange(value);
        syncSettingsToServer();
    });

    input.addEventListener('change', (e) => {
        let value = parseFloat(e.target.value);
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        value = Math.max(min, Math.min(max, value));
        e.target.value = value;
        slider.value = value;
        config[configKey] = value;
        updateSliderTrack(slider);
        if (onChange) onChange(value);
        syncSettingsToServer();
    });

    updateSliderTrack(slider);
}

function updateSliderTrack(slider) {
    const percent = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
    slider.style.background = `linear-gradient(to right, var(--primary) ${percent}%, var(--bg-input) ${percent}%)`;
}

function updateStatusBadges() {
    const langValue = document.getElementById('status-language-value');
    if (langValue) {
        const lang = config.language || 'hindi';
        langValue.textContent = lang.charAt(0).toUpperCase() + lang.slice(1);
    }
    const kbBadge = document.getElementById('status-kb-badge');
    const kbValue = document.getElementById('status-kb-value');
    if (kbBadge && kbValue) {
        const isKBEnabled = config.enabledTools && config.enabledTools.includes('search_knowledge_base');
        if (isKBEnabled) {
            kbBadge.classList.add('active');
            kbValue.textContent = 'Ready';
        } else {
            kbBadge.classList.remove('active');
            kbValue.textContent = 'Disabled';
        }
    }
}

function applyConfigToUI() {
    // Custom dropdowns
    setCustomSelectValue('voice-type', config.voiceId);
    setCustomSelectValue('language-select', config.language || 'hindi');
    setCustomSelectValue('response-timing', config.responseTiming);
    setCustomSelectValue('output-sample-rate', String(config.outputSampleRate));

    // Textarea
    systemPromptTextarea.value = config.systemPrompt;

    // Sliders
    temperatureSlider.value = config.temperature;
    temperatureValue.value = config.temperature;
    topPSlider.value = config.topP;
    topPValue.value = config.topP;
    maxTokensSlider.value = config.maxTokens;
    maxTokensValue.value = config.maxTokens;
    audioBufferSlider.value = config.audioBufferMs;
    audioBufferValue.value = config.audioBufferMs;
    
    vadThresholdSlider.value = config.vadThreshold;
    vadThresholdValue.value = config.vadThreshold;
    bargeInThresholdSlider.value = config.bargeInThreshold;
    bargeInThresholdValue.value = config.bargeInThreshold;

    enableBargeInCheckbox.checked = config.enableBargeIn !== false;
    bargeInThresholdSlider.disabled = !config.enableBargeIn;
    bargeInThresholdValue.disabled = !config.enableBargeIn;

    // Update slider tracks
    updateSliderTrack(temperatureSlider);
    updateSliderTrack(topPSlider);
    updateSliderTrack(maxTokensSlider);
    updateSliderTrack(audioBufferSlider);
    updateSliderTrack(vadThresholdSlider);
    updateSliderTrack(bargeInThresholdSlider);
    
    updateStatusBadges();
}

function syncSettingsToServer() {
    saveConfig();
    updateStatusBadges();
    if (isStreaming && socket.connected) {
        console.log('[Settings] Syncing config to server:', {
            language: config.language,
            systemPrompt: config.systemPrompt,
            voiceId: config.voiceId,
            temperature: config.temperature,
            topP: config.topP,
            maxTokens: config.maxTokens,
            enabledTools: config.enabledTools,
            outputSampleRate: config.outputSampleRate
        });
        socket.emit('sarvamUpdateConfig', {
            language: config.language,
            systemPrompt: config.systemPrompt,
            voiceId: config.voiceId,
            temperature: config.temperature,
            topP: config.topP,
            maxTokens: config.maxTokens,
            enabledTools: config.enabledTools,
            outputSampleRate: config.outputSampleRate
        });
    }
}

function saveConfig() {
    localStorage.setItem('novaSonicConfig', JSON.stringify(config));
}

// Tools management
async function loadAvailableTools() {
    const toolsList = document.getElementById('tools-list');
    try {
        const response = await fetch('/api/tools');
        if (!response.ok) throw new Error('Failed to fetch tools');
        
        const data = await response.json();
        availableTools = data.tools || [];
        
        // If enabledTools is empty (first load), enable all tools by default
        if (config.enabledTools.length === 0) {
            config.enabledTools = availableTools.map(t => t.name);
            saveConfig();
        }
        
        renderToolsList();
    } catch (error) {
        console.error('Failed to load tools:', error);
        toolsList.innerHTML = '<div class="tools-loading">Failed to load tools</div>';
    }
}

function truncateDescription(desc, maxLen = 60) {
    if (!desc) return '';
    // Find first sentence (up to ". ")
    const sentenceEnd = desc.indexOf('. ');
    if (sentenceEnd > 0 && sentenceEnd < maxLen) {
        return desc.substring(0, sentenceEnd + 1);
    }
    // Otherwise truncate at maxLen
    if (desc.length <= maxLen) return desc;
    return desc.substring(0, maxLen).trim() + '…';
}

function renderToolsList() {
    const toolsList = document.getElementById('tools-list');
    if (!toolsList || availableTools.length === 0) {
        toolsList.textContent = '';
        const noToolsDiv = document.createElement('div');
        noToolsDiv.className = 'tools-loading';
        noToolsDiv.textContent = 'No tools available';
        toolsList.appendChild(noToolsDiv);
        return;
    }
    
    toolsList.textContent = '';
    availableTools.forEach(tool => {
        const item = document.createElement('div');
        item.className = 'tool-toggle-item';
        item.dataset.tool = tool.name;
        
        const label = document.createElement('label');
        label.className = 'tool-checkbox';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = config.enabledTools.includes(tool.name);
        checkbox.dataset.toolName = tool.name;
        
        const checkmark = document.createElement('span');
        checkmark.className = 'checkmark';
        
        label.appendChild(checkbox);
        label.appendChild(checkmark);
        
        const toolInfo = document.createElement('div');
        toolInfo.className = 'tool-info';
        
        const toolName = document.createElement('div');
        toolName.className = 'tool-info-name';
        toolName.textContent = tool.name;
        
        const toolDesc = document.createElement('div');
        toolDesc.className = 'tool-info-description';
        toolDesc.textContent = truncateDescription(tool.description);
        
        toolInfo.appendChild(toolName);
        toolInfo.appendChild(toolDesc);
        
        item.appendChild(label);
        item.appendChild(toolInfo);
        toolsList.appendChild(item);
        
        checkbox.addEventListener('change', (e) => {
            const name = e.target.dataset.toolName;
            if (e.target.checked) {
                if (!config.enabledTools.includes(name)) {
                    config.enabledTools.push(name);
                }
            } else {
                config.enabledTools = config.enabledTools.filter(t => t !== name);
            }
            syncSettingsToServer();
        });
    });
}

function setToolsDisabled(disabled) {
    const toolsList = document.getElementById('tools-list');
    if (!toolsList) return;
    
    toolsList.querySelectorAll('.tool-toggle-item').forEach(item => {
        item.classList.toggle('disabled', disabled);
    });
    toolsList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.disabled = disabled;
    });
}

// Theme toggle
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    isDarkMode = savedTheme === 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    themeToggle.addEventListener('click', () => {
        isDarkMode = !isDarkMode;
        const theme = isDarkMode ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    });
}

// Waveform Animation - Full-width vibrating single line
function initWaveformCanvas() {
    const dpr = window.devicePixelRatio || 1;
    
    // Main waveform canvas (full width)
    const rect = waveformCanvas.getBoundingClientRect();
    waveformCanvas.width = rect.width * dpr;
    waveformCanvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    // Ring canvas (around button) - use fixed size matching CSS
    const ringSize = 200;
    ringCanvas.width = ringSize * dpr;
    ringCanvas.height = ringSize * dpr;
    ringCtx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
    ringCtx.scale(dpr, dpr);
}

function startWaveformAnimation() {
    if (isAnimating) return;
    isAnimating = true;
    animateWaveform();
}

function stopWaveformAnimation() {
    isAnimating = false;
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    // Clear audio fade timer
    if (audioFadeTimer) {
        clearTimeout(audioFadeTimer);
        audioFadeTimer = null;
    }
    // Reset audio levels and duration tracking
    targetAudioLevel = 0;
    targetAssistantAudioLevel = 0;
    audioLevel = 0;
    assistantAudioLevel = 0;
    speechStartTime = 0;
    totalAudioDuration = 0;
    ringFadeAlpha = 0;
    isRingFadingOut = false;
    const rect = waveformCanvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ringCtx.clearRect(0, 0, 200, 200);
}

function animateWaveform() {
    if (!isAnimating) return;

    const rect = waveformCanvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const centerY = height / 2;
    const time = Date.now() * 0.004;

    ctx.clearRect(0, 0, width, height);

    // Smooth audio level transitions
    audioLevel += (targetAudioLevel - audioLevel) * 0.18;
    // Slower smoothing for assistant level to allow visible fade out
    // Only keep level high while actively receiving audio chunks (not during/after fade)
    const isActivelyReceivingAudio = speechStartTime > 0 && !isRingFadingOut && ringFadeAlpha === 1;
    const effectiveTargetAssistantLevel = isActivelyReceivingAudio ? Math.max(targetAssistantAudioLevel, 0.5) : targetAssistantAudioLevel;
    const assistantSmoothing = effectiveTargetAssistantLevel < assistantAudioLevel ? 0.03 : 0.15;
    assistantAudioLevel += (effectiveTargetAssistantLevel - assistantAudioLevel) * assistantSmoothing;
    
    // Horizontal waveform responds only to user's microphone
    const userLevel = audioLevel;
    
    // Base amplitude - nearly flat when idle, energetic when speaking
    const baseAmplitude = 1 + userLevel * 59;
    
    // Vibration intensity - almost completely still when idle
    const vibrationIntensity = 0.005 + userLevel * 0.995;

    // Draw single vibrating line with heavy glow (user mic only)
    drawSingleGlowingWave(ctx, width, centerY, baseAmplitude, time, userLevel, vibrationIntensity);
    
    // Draw circular waveform around button for assistant audio only (on separate canvas)
    const ringSize = 200;
    ringCtx.clearRect(0, 0, ringSize, ringSize);
    
    // Update ring fade alpha
    if (assistantAudioLevel > 0.02 && !isRingFadingOut) {
        ringFadeAlpha = 1;
    } else if (isRingFadingOut && ringFadeAlpha > 0) {
        ringFadeAlpha -= 0.02; // Fade out over ~50 frames (~800ms at 60fps)
        if (ringFadeAlpha <= 0) {
            ringFadeAlpha = 0;
            isRingFadingOut = false;
            // Force reset audio levels to prevent re-triggering
            assistantAudioLevel = 0;
            targetAssistantAudioLevel = 0;
        }
    }
    
    // Draw ring only when there's actual assistant audio
    if (ringFadeAlpha > 0 && (assistantAudioLevel > 0.02 || isRingFadingOut)) {
        const ringCenterX = ringSize / 2;
        const ringCenterY = ringSize / 2;
        // Keep vibration active during fade out - use last known level or minimum active level
        const displayLevel = isRingFadingOut ? Math.max(0.4, assistantAudioLevel) : assistantAudioLevel;
        drawAssistantCircularWave(ringCtx, ringCenterX, ringCenterY, time, displayLevel, ringFadeAlpha);
    }

    animationId = requestAnimationFrame(animateWaveform);
}

function drawSingleGlowingWave(ctx, width, centerY, amplitude, time, level, vibrationIntensity) {
    const freq = 0.012;
    const phase = time * 4;

    // Build the wave path
    ctx.beginPath();
    ctx.moveTo(0, centerY);

    for (let x = 0; x <= width; x += 1) {
        // Main wave components - faster and more dynamic
        const wave1 = Math.sin(x * freq + phase) * amplitude;
        const wave2 = Math.sin(x * freq * 2.3 + phase * 2.5) * amplitude * 0.6;
        const wave3 = Math.sin(x * freq * 0.7 + phase * 1.2) * amplitude * 0.5;
        
        // High-frequency vibration - cranked up
        const vibration = Math.sin(x * 0.1 + time * 25) * amplitude * 0.45 * vibrationIntensity;
        const microVibration = Math.sin(x * 0.25 + time * 45) * amplitude * 0.35 * vibrationIntensity;
        
        // Heavy bounce effects - makes it jump aggressively
        const bounce = Math.sin(time * 35) * amplitude * 0.4 * vibrationIntensity;
        const bounce2 = Math.cos(time * 28) * amplitude * 0.3 * vibrationIntensity;
        const rapidPulse = Math.sin(time * 60 + x * 0.03) * amplitude * 0.25 * vibrationIntensity;
        
        // Maximum chaos - erratic movement
        const jitter = (Math.sin(x * 0.4 + time * 50) * Math.cos(x * 0.22 + time * 35)) * amplitude * 0.4 * level;
        const chaos = Math.sin(x * 0.6 + time * 70) * amplitude * 0.2 * level;
        const chaos2 = Math.cos(x * 0.35 + time * 55) * Math.sin(time * 80) * amplitude * 0.25 * level;
        const spikes = Math.sin(x * 0.8 + time * 90) * amplitude * 0.15 * vibrationIntensity;
        
        const y = centerY + wave1 + wave2 + wave3 + vibration + microVibration + bounce + bounce2 + rapidPulse + jitter + chaos + chaos2 + spikes;
        ctx.lineTo(x, y);
    }

    // Rotating hue for rainbow effect
    hueRotation = (hueRotation + 0.5) % 360;
    const hue1 = hueRotation;
    const hue2 = (hueRotation + 60) % 360;
    const hue3 = (hueRotation + 180) % 360;

    // Create rainbow gradient
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    const alpha = 0.7 + level * 0.3;
    gradient.addColorStop(0, `hsla(${hue1}, 100%, 60%, ${alpha})`);
    gradient.addColorStop(0.33, `hsla(${hue2}, 100%, 65%, ${alpha})`);
    gradient.addColorStop(0.66, `hsla(${hue3}, 100%, 60%, ${alpha})`);
    gradient.addColorStop(1, `hsla(${(hue1 + 300) % 360}, 100%, 65%, ${alpha})`);

    // Heavy glow effect - multiple layers
    ctx.save();
    
    // Outer glow
    ctx.shadowColor = `hsla(${hue2}, 100%, 60%, ${0.4 + level * 0.4})`;
    ctx.shadowBlur = 25 + level * 40;
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2 + level * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    
    // Middle glow layer
    ctx.shadowColor = `hsla(${hue1}, 100%, 70%, ${0.5 + level * 0.3})`;
    ctx.shadowBlur = 15 + level * 25;
    ctx.stroke();
    
    // Inner bright core
    ctx.shadowColor = `hsla(${hue3}, 100%, 80%, ${0.6 + level * 0.4})`;
    ctx.shadowBlur = 8 + level * 15;
    ctx.lineWidth = 1.5 + level * 1.5;
    ctx.stroke();
    
    ctx.restore();
}

function drawAssistantCircularWave(context, centerX, centerY, time, level, fadeAlpha = 1) {
    const buttonRadius = 50;
    const ringRadius = buttonRadius + 12 + level * 15;
    
    // Blue hue (220) when idle, rotating rainbow when active
    const baseHue = 220; // Blue
    const hue = level > 0.1 ? (time * 50) % 360 : baseHue;
    const alpha = (0.6 + level * 0.4) * fadeAlpha;
    
    // Draw full outer circle ring with vibrating thickness
    const segments = 120;
    
    // Create gradient around the circle
    context.beginPath();
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        
        // More reactive vibration based on audio level
        const vibration = Math.sin(angle * 8 + time * 12) * 8 * level;
        const microVibration = Math.sin(angle * 16 + time * 20) * 5 * level;
        const pulse = Math.sin(time * 5) * 6 * level;
        const jitter = Math.sin(angle * 24 + time * 30) * 3 * level;
        const r = ringRadius + vibration + microVibration + pulse + jitter;
        
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    }
    context.closePath();
    
    // Multi-layer glow effect
    context.save();
    
    // Outer glow
    context.shadowColor = `hsla(${hue}, 100%, 60%, ${alpha * 0.8})`;
    context.shadowBlur = 30 + level * 50;
    context.strokeStyle = `hsla(${hue}, 100%, 65%, ${alpha})`;
    context.lineWidth = 2 + level * 3;
    context.stroke();
    
    // Middle glow with shifted color (only shift when active)
    const hue2 = level > 0.1 ? (hue + 60) % 360 : baseHue;
    context.shadowColor = `hsla(${hue2}, 100%, 60%, ${alpha * 0.6})`;
    context.shadowBlur = 20 + level * 35;
    context.stroke();
    
    // Inner bright core
    const hue3 = level > 0.1 ? (hue + 120) % 360 : baseHue;
    context.shadowColor = `hsla(${hue3}, 100%, 70%, ${alpha * 0.7})`;
    context.shadowBlur = 10 + level * 20;
    context.lineWidth = 1 + level * 2;
    context.stroke();
    
    context.restore();
}

function updateAudioLevel(level) {
    targetAudioLevel = Math.min(1, level * 3);
}

function updateAssistantAudioLevel(level) {
    targetAssistantAudioLevel = Math.min(1, level * 3);
}

// Initialize WebSocket audio
async function initAudio() {
    try {
        // Request microphone access
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: { ideal: true },
                noiseSuppression: { ideal: true },
                autoGainControl: { ideal: true },
                googEchoCancellation: { ideal: true },
                googAutoGainControl: { ideal: true },
                googNoiseSuppression: { ideal: true },
                googHighpassFilter: { ideal: true }
            }
        });

        // Create audio context if needed
        if (!audioContext || audioContext.state === 'closed') {
            if (isFirefox) {
                audioContext = new AudioContext();
            } else {
                audioContext = new AudioContext({
                    sampleRate: TARGET_SAMPLE_RATE
                });
            }
        }

        samplingRatio = audioContext.sampleRate / TARGET_SAMPLE_RATE;
        await audioPlayer.start(config.outputSampleRate, config.audioBufferMs);
    } catch (error) {
        console.error("Error accessing microphone:", error);
        throw error;
    }
}

let recognition = null;

function startSpeechRecognition() {
    if (recognition) {
        try {
            recognition.stop();
        } catch (e) {}
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn("SpeechRecognition not supported in this browser.");
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    // Set language map
    const langCodes = {
        'hindi': 'hi-IN', 'english': 'en-IN', 'tamil': 'ta-IN', 'telugu': 'te-IN',
        'kannada': 'kn-IN', 'bengali': 'bn-IN', 'malayalam': 'ml-IN', 'marathi': 'mr-IN',
        'gujarati': 'gu-IN', 'punjabi': 'pa-IN', 'odia': 'or-IN', 'assamese': 'as-IN'
    };
    recognition.lang = langCodes[config.language.toLowerCase()] || 'en-IN';

    recognition.onstart = () => {
        console.log('[SpeechRecognition] Started');
    };

    recognition.onerror = (event) => {
        if (event.error === 'not-allowed') {
            console.error('[SpeechRecognition] Mic access not allowed');
        } else {
            console.error('[SpeechRecognition] Error:', event.error);
        }
    };

    recognition.onend = () => {
        console.log('[SpeechRecognition] Ended');
        // Restart if we are still streaming and the assistant is NOT speaking
        if (isStreaming && !isAssistantSpeaking) {
            try {
                recognition.start();
            } catch (e) {
                // Ignore error if already started
            }
        }
    };

    recognition.onresult = (event) => {
        if (isAssistantSpeaking || Date.now() < bargeInCooldownEndTime) {
            return;
        }

        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        const text = (finalTranscript + interimTranscript).trim();
        if (text) {
            console.log('[SpeechRecognition] Real-time text:', text);
            chatHistoryManager.updateUserTranscript(text);
        }
    };

    try {
        recognition.start();
    } catch (e) {
        console.error('[SpeechRecognition] Error starting recognition:', e);
    }
}

function stopSpeechRecognition() {
    if (recognition) {
        try {
            recognition.stop();
        } catch (e) {}
        recognition = null;
    }
}

async function startStreaming() {
    if (isStreaming || isInitializing) return;
    isInitializing = true;

    try {
        // Clear chat history on new conversation start
        chatHistoryManager.clearHistory();
        clearChatUI();

        // Reset VAD state to prevent old state from triggering
        window._sarvamSpeaking = false;
        if (window._sarvamTimer) {
            clearTimeout(window._sarvamTimer);
            window._sarvamTimer = null;
        }
        isAssistantSpeaking = false;

        if (!socket.connected) {
            socket.connect();
            await new Promise((resolve) => {
                if (socket.connected) resolve();
                else socket.once('connect', resolve);
            });
        }

        // Re-initialize audio if microphone was released
        if (!audioStream || !audioContext || audioContext.state === 'closed') {
            await initAudio();
        }

        if (!audioPlayer.initialized) {
            await audioPlayer.start(config.outputSampleRate, config.audioBufferMs);
        }

        if (!sessionInitialized) {
            if (!config.systemPrompt || !config.systemPrompt.trim()) {
                await loadPromptPreset('default');
            }
            socket.emit('sarvamStart', { 
                language: config.language, 
                systemPrompt: config.systemPrompt, 
                voiceId: config.voiceId,
                temperature: config.temperature,
                topP: config.topP,
                maxTokens: config.maxTokens,
                enabledTools: config.enabledTools,
                outputSampleRate: config.outputSampleRate
            });
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Pipeline start timeout')), 15000);
                socket.once('sarvamReady', () => { clearTimeout(timeout); resolve(); });
                socket.once('error', (e) => { clearTimeout(timeout); reject(new Error(e.details || e.message)); });
            });
            sessionInitialized = true;
        }

        sourceNode = audioContext.createMediaStreamSource(audioStream);

        if (audioContext.createScriptProcessor) {
            processor = audioContext.createScriptProcessor(512, 1, 1);

            processor.onaudioprocess = (e) => {
                if (!isStreaming) return;

                const inputData = e.inputBuffer.getChannelData(0);
                const numSamples = Math.round(inputData.length / samplingRatio);
                const pcmData = isFirefox ? (new Int16Array(numSamples)) : (new Int16Array(inputData.length));

                // Calculate audio level for visualization and barge-in VAD
                let sum = 0;
                for (let i = 0; i < inputData.length; i++) {
                    sum += inputData[i] * inputData[i];
                }
                const rms = Math.sqrt(sum / inputData.length);
                updateAudioLevel(rms);

                // Update running noise floor when room is quiet
                if (!isAssistantSpeaking && !isWaitingForResponse && !window._sarvamSpeaking && !window._sarvamTimer) {
                    noiseFloor = noiseFloor * 0.98 + rms * 0.02;
                }

                // Barge-in Cooldown: Discard microphone capture for a short period after barge-in
                if (Date.now() < bargeInCooldownEndTime) {
                    window._sarvamSpeaking = false;
                    if (window._sarvamTimer) {
                        clearTimeout(window._sarvamTimer);
                        window._sarvamTimer = null;
                    }
                    consecutiveSpeechFrames = 0;
                    return;
                }

                // Compute adaptive barge-in threshold (elevated when assistant is speaking to suppress speaker echo)
                const baseBargeInThreshold = Math.max(config.bargeInThreshold, noiseFloor * 1.8);
                const activeBargeInThreshold = isAssistantSpeaking
                    ? Math.max(config.bargeInThreshold * 1.6, noiseFloor * 2.2)
                    : baseBargeInThreshold;

                // Barge-in Interruption: User starts speaking while AI is playing
                const assistantSpeakingDuration = Date.now() - assistantSpeakStartTime;
                if (config.enableBargeIn && isAssistantSpeaking && assistantSpeakingDuration > 1000) {
                    if (rms > activeBargeInThreshold) {
                        consecutiveSpeechFrames++;
                        if (consecutiveSpeechFrames >= 4) { // Requires ~50-120ms of continuous sound
                            console.log('[VAD] Speech detected during AI turn! Interrupting assistant. RMS:', rms.toFixed(5), 'Threshold:', activeBargeInThreshold.toFixed(5), 'NoiseFloor:', noiseFloor.toFixed(5));
                            
                            // Activate cooldown to discard echo/residual audio
                            bargeInCooldownEndTime = Date.now() + 800;
                            consecutiveSpeechFrames = 0;
                            
                            // Stop client playback immediately
                            audioPlayer.bargeIn();
                            
                            // Notify server to stop generation / sequential speaking
                            socket.emit('interruptAssistant');
                            
                            // Reset client-side turn state
                            isAssistantSpeaking = false;
                            isWaitingForResponse = false;
                            
                            // UI: Mark last assistant message as interrupted
                            chatHistoryManager.markLastAssistantInterrupted();
                            
                            // Start user recording state
                            if (window._sarvamTimer) {
                                clearTimeout(window._sarvamTimer);
                                window._sarvamTimer = null;
                            }
                            window._sarvamSpeaking = true;
                            
                            // Restart local speech recognition to capture text after a short delay
                            setTimeout(() => {
                                if (isStreaming && !isAssistantSpeaking && Date.now() >= bargeInCooldownEndTime) {
                                    startSpeechRecognition();
                                }
                            }, 500);
                        }
                    } else {
                        consecutiveSpeechFrames = 0;
                    }
                } else {
                    consecutiveSpeechFrames = 0;
                }

                // If assistant is still speaking or we are waiting, discard mic capture
                if (isAssistantSpeaking || isWaitingForResponse) {
                    window._sarvamSpeaking = false;
                    if (window._sarvamTimer) {
                        clearTimeout(window._sarvamTimer);
                        window._sarvamTimer = null;
                    }
                    return;
                }

                if (isFirefox) {
                    for (let i = 0; i < numSamples; i++) {
                        pcmData[i] = Math.max(-1, Math.min(1, inputData[Math.floor(i * samplingRatio)])) * 0x7FFF;
                    }
                } else {
                    for (let i = 0; i < inputData.length; i++) {
                        pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
                    }
                }

                const base64Data = arrayBufferToBase64(pcmData.buffer);
                socket.emit('audioInput', base64Data);

                // Compute adaptive VAD threshold to prevent noise locks
                const activeVadThreshold = Math.max(config.vadThreshold, noiseFloor * 1.5);

                // Sarvam VAD: trigger after 800ms silence
                if (isSarvamLanguage(config.language)) {
                    if (!window._lastRmsLog || Date.now() - window._lastRmsLog > 2000) {
                        console.log('[VAD] Current mic level (RMS):', rms.toFixed(5), 'Threshold:', activeVadThreshold.toFixed(5), 'NoiseFloor:', noiseFloor.toFixed(5), 'Speaking state:', !!window._sarvamSpeaking, 'Timer active:', !!window._sarvamTimer);
                        window._lastRmsLog = Date.now();
                    }

                    if (rms > activeVadThreshold) { 
                        if (window._sarvamTimer) {
                            clearTimeout(window._sarvamTimer);
                            window._sarvamTimer = null;
                        }
                        if (!window._sarvamSpeaking) {
                            console.log('[VAD] Speech detected! RMS:', rms.toFixed(5));
                        }
                        window._sarvamSpeaking = true; 
                    }
                    else if (window._sarvamSpeaking) {
                        if (!window._sarvamTimer) {
                            const timings = {
                                'fast': 600,
                                'medium': 1200,
                                'slow': 2000
                            };
                            const silenceTimeout = timings[config.responseTiming] || 1200;
                            window._sarvamTimer = setTimeout(() => {
                                console.log(`[VAD] Silence detected (${silenceTimeout}ms). Sending end of turn signal to server.`);
                                window._sarvamSpeaking = false;
                                isWaitingForResponse = true;
                                stopSpeechRecognition();
                                socket.emit('sarvamAudioEnd');
                                window._sarvamTimer = null;
                            }, silenceTimeout);
                        }
                    }
                }
            };

            sourceNode.connect(processor);
            processor.connect(audioContext.destination);
        }

        isStreaming = true;
        voiceBtn.classList.add('active');
        micIcon.classList.add('hidden');
        stopIcon.classList.remove('hidden');
        voiceHint.textContent = 'Tap to stop';
        
        // Disable settings during conversation
        // setSettingsDisabled(true);

        // Start waveform animation
        initWaveformCanvas();
        startWaveformAnimation();

        transcriptionReceived = false;
        startSpeechRecognition();

    } catch (error) {
        console.error("Error starting recording:", error);
    } finally {
        isInitializing = false;
    }
}

function arrayBufferToBase64(buffer) {
    const binary = [];
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary.push(String.fromCharCode(bytes[i]));
    }
    return btoa(binary.join(''));
}

function stopStreaming() {
    if (!isStreaming) return;

    isStreaming = false;
    isAssistantSpeaking = false;
    isWaitingForResponse = false;
    stopSpeechRecognition();
    window._sarvamSpeaking = false;
    if (window._sarvamTimer) {
        clearTimeout(window._sarvamTimer);
        window._sarvamTimer = null;
    }
    clearSessionTimers(); // Clear session timeout timers
    hideSessionWarning();
    
    if (currentKBIndicator) {
        currentKBIndicator.remove();
        currentKBIndicator = null;
    }

    if (processor) {
        processor.disconnect();
        sourceNode.disconnect();
        processor = null;
        sourceNode = null;
    }

    // Release the microphone by stopping all tracks
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }

    // Close the audio context
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
        audioContext = null;
    }

    voiceBtn.classList.remove('active');
    micIcon.classList.remove('hidden');
    stopIcon.classList.add('hidden');
    voiceHint.textContent = 'Tap to start conversation';

    // Stop waveform animation
    stopWaveformAnimation();

    audioPlayer.bargeIn();
    socket.emit('stopAudio');
    chatHistoryManager.endTurn();

    sessionInitialized = false;
    manualDisconnect = true;
    socket.disconnect();
    
    // Re-enable settings after conversation ends
    // setSettingsDisabled(false);
}

function base64ToFloat32Array(base64String) {
    try {
        const binaryString = window.atob(base64String);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }

        return float32Array;
    } catch (error) {
        console.error('Error in base64ToFloat32Array:', error);
        throw error;
    }
}

function handleTextOutput(data) {
    if (data.content) {
        const messageData = {
            role: data.role,
            message: data.content,
            detectedLanguage: data.detectedLanguage
        };
        chatHistoryManager.addTextMessage(messageData);
    }
}

function createNovaIcon() {
    const img = document.createElement('img');
    img.src = '/nova-icon.png';
    img.alt = 'Nova';
    img.className = 'nova-icon';
    return img;
}

function getPreviousUserLanguage(currentIndex) {
    if (!chat || !chat.history) return null;
    for (let i = currentIndex - 1; i >= 0; i--) {
        const item = chat.history[i];
        if (item && item.role?.toUpperCase() === 'USER' && item.detectedLanguage) {
            return item.detectedLanguage;
        }
    }
    return null;
}

// Track rendered message count to avoid re-rendering
let renderedMessageCount = 0;

function createMessageElement(item, index) {
    if (item.endOfConversation) {
        const endDiv = document.createElement('div');
        endDiv.className = 'message system';
        endDiv.textContent = "Conversation ended";
        return endDiv;
    }

    // Handle tool usage cards
    if (item.type === 'tool') {
        return createToolCard(item);
    }

    if (item.role) {
        const roleLowerCase = item.role.toLowerCase();
        
        // Wrap in message-wrapper to support inline metadata
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${roleLowerCase}`;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${roleLowerCase}`;

        // Add Nova icon for assistant messages
        if (roleLowerCase === 'assistant') {
            const iconWrapper = document.createElement('div');
            iconWrapper.className = 'message-icon';
            iconWrapper.appendChild(createNovaIcon());
            messageDiv.appendChild(iconWrapper);
        }

        const content = document.createElement('div');
        content.className = 'message-content';
        content.textContent = item.message || "";
        
        // Add interrupted indicator for assistant messages
        if (roleLowerCase === 'assistant' && item.interrupted) {
            const interruptedSpan = document.createElement('div');
            interruptedSpan.className = 'interrupted-indicator';
            interruptedSpan.textContent = '(interrupted)';
            content.appendChild(interruptedSpan);
        }
        
        messageDiv.appendChild(content);
        wrapper.appendChild(messageDiv);

        // If it's a USER message and detected language changed, display it underneath the bubble
        if (roleLowerCase === 'user' && item.detectedLanguage) {
            const prevLang = getPreviousUserLanguage(index);
            if (!prevLang || prevLang.toLowerCase() !== item.detectedLanguage.toLowerCase()) {
                const subInfo = document.createElement('div');
                subInfo.className = 'message-sub-info';
                subInfo.innerHTML = `🌐 Detected: ${item.detectedLanguage}`;
                wrapper.appendChild(subInfo);
            }
        }

        return wrapper;
    }
    return null;
}

function createToolCard(item) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.dataset.toolUseId = item.toolUseId;

    // Header (clickable to expand/collapse)
    const header = document.createElement('div');
    header.className = 'tool-header';
    
    // Tool icon (wrench/gear)
    const toolIconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    toolIconSvg.setAttribute('class', 'tool-icon');
    toolIconSvg.setAttribute('viewBox', '0 0 24 24');
    toolIconSvg.setAttribute('fill', 'none');
    toolIconSvg.setAttribute('stroke', 'currentColor');
    toolIconSvg.setAttribute('stroke-width', '2');
    const toolIconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    toolIconPath.setAttribute('d', 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z');
    toolIconSvg.appendChild(toolIconPath);
    header.appendChild(toolIconSvg);

    const toolName = document.createElement('span');
    toolName.className = 'tool-name';
    toolName.textContent = formatToolName(item.toolName);
    header.appendChild(toolName);

    // Status indicator
    const status = document.createElement('div');
    status.className = `tool-status ${item.status}`;
    
    if (item.status === 'running') {
        const spinner = document.createElement('div');
        spinner.className = 'tool-spinner';
        const runningText = document.createElement('span');
        runningText.textContent = 'Running';
        status.appendChild(spinner);
        status.appendChild(runningText);
    } else {
        const elapsed = item.elapsed ? formatElapsed(item.elapsed) : '';
        const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        checkSvg.setAttribute('class', 'tool-check');
        checkSvg.setAttribute('viewBox', '0 0 24 24');
        checkSvg.setAttribute('fill', 'none');
        checkSvg.setAttribute('stroke', 'currentColor');
        checkSvg.setAttribute('stroke-width', '2');
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', '20 6 9 17 4 12');
        checkSvg.appendChild(polyline);
        const elapsedSpan = document.createElement('span');
        elapsedSpan.className = 'tool-elapsed';
        elapsedSpan.textContent = elapsed;
        status.appendChild(checkSvg);
        status.appendChild(elapsedSpan);
    }
    header.appendChild(status);

    // Expand icon
    const expandSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    expandSvg.setAttribute('class', 'tool-expand-icon');
    expandSvg.setAttribute('viewBox', '0 0 24 24');
    expandSvg.setAttribute('fill', 'none');
    expandSvg.setAttribute('stroke', 'currentColor');
    expandSvg.setAttribute('stroke-width', '2');
    const expandPolyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    expandPolyline.setAttribute('points', '6 9 12 15 18 9');
    expandSvg.appendChild(expandPolyline);
    header.appendChild(expandSvg);

    card.appendChild(header);

    // Details section (collapsible)
    const details = document.createElement('div');
    details.className = 'tool-details';

    // Input section
    const inputSection = document.createElement('div');
    inputSection.className = 'tool-section';
    const inputLabel = document.createElement('div');
    inputLabel.className = 'tool-section-label';
    inputLabel.textContent = 'Input';
    const inputContent = document.createElement('div');
    inputContent.className = 'tool-section-content';
    inputContent.textContent = formatToolData(item.input);
    inputSection.appendChild(inputLabel);
    inputSection.appendChild(inputContent);
    details.appendChild(inputSection);

    // Output section (only if completed)
    if (item.status === 'completed' && item.output !== undefined) {
        const outputSection = document.createElement('div');
        outputSection.className = 'tool-section';
        const outputLabel = document.createElement('div');
        outputLabel.className = 'tool-section-label';
        outputLabel.textContent = 'Output';
        const outputContent = document.createElement('div');
        outputContent.className = 'tool-section-content';
        outputContent.textContent = formatToolData(item.output);
        outputSection.appendChild(outputLabel);
        outputSection.appendChild(outputContent);
        details.appendChild(outputSection);
    }

    card.appendChild(details);

    // Toggle expand on header click
    header.addEventListener('click', () => {
        card.classList.toggle('expanded');
    });

    return card;
}

function formatToolName(name) {
    // Convert camelCase or snake_case to readable format
    return name
        .replace(/([A-Z])/g, ' $1')
        .replace(/_/g, ' ')
        .replace(/^./, str => str.toUpperCase())
        .trim();
}

function formatElapsed(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function formatToolData(data) {
    if (data === null || data === undefined) return 'null';
    if (typeof data === 'string') {
        try {
            const parsed = JSON.parse(data);
            return JSON.stringify(parsed, null, 2);
        } catch {
            return data;
        }
    }
    return JSON.stringify(data, null, 2);
}

// Floating tool card that stays at the bottom during streaming
let floatingToolCards = new Map(); // Map of toolUseId -> card element

function showToolCard(toolData) {
    // Track tool execution in memory, but do not append cards to the main message replies list
    if (floatingToolCards.has(toolData.toolUseId)) {
        return;
    }
    
    const card = createToolCard(toolData);
    card.dataset.toolUseId = toolData.toolUseId;
    floatingToolCards.set(toolData.toolUseId, card);
}

function updateToolCardById(toolUseId, toolData) {
    const card = floatingToolCards.get(toolUseId);
    if (!card) return;
    
    // Check if this is an error result
    const isError = toolData.output?.error === true;
    
    // Update status indicator
    const status = card.querySelector('.tool-status');
    if (status && !card.dataset.completed) {
        const elapsed = toolData.elapsed ? formatElapsed(toolData.elapsed) : '';
        
        status.textContent = '';
        
        if (isError) {
            status.className = 'tool-status error';
            const errorSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            errorSvg.setAttribute('class', 'tool-error');
            errorSvg.setAttribute('viewBox', '0 0 24 24');
            errorSvg.setAttribute('fill', 'none');
            errorSvg.setAttribute('stroke', 'currentColor');
            errorSvg.setAttribute('stroke-width', '2');
            const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line1.setAttribute('x1', '18'); line1.setAttribute('y1', '6');
            line1.setAttribute('x2', '6'); line1.setAttribute('y2', '18');
            const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line2.setAttribute('x1', '6'); line2.setAttribute('y1', '6');
            line2.setAttribute('x2', '18'); line2.setAttribute('y2', '18');
            errorSvg.appendChild(line1);
            errorSvg.appendChild(line2);
            const elapsedSpan = document.createElement('span');
            elapsedSpan.className = 'tool-elapsed';
            elapsedSpan.textContent = elapsed;
            status.appendChild(errorSvg);
            status.appendChild(elapsedSpan);
        } else {
            status.className = 'tool-status completed';
            const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            checkSvg.setAttribute('class', 'tool-check');
            checkSvg.setAttribute('viewBox', '0 0 24 24');
            checkSvg.setAttribute('fill', 'none');
            checkSvg.setAttribute('stroke', 'currentColor');
            checkSvg.setAttribute('stroke-width', '2');
            const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            polyline.setAttribute('points', '20 6 9 17 4 12');
            checkSvg.appendChild(polyline);
            const elapsedSpan = document.createElement('span');
            elapsedSpan.className = 'tool-elapsed';
            elapsedSpan.textContent = elapsed;
            status.appendChild(checkSvg);
            status.appendChild(elapsedSpan);
        }
        card.dataset.completed = 'true';
    }
    
    // Add output section only once
    const details = card.querySelector('.tool-details');
    if (details && toolData.output !== undefined && !card.dataset.hasOutput) {
        const outputSection = document.createElement('div');
        outputSection.className = 'tool-section' + (isError ? ' tool-error-output' : '');
        const outputLabelText = isError ? 'Error' : 'Output';
        const outputContentText = isError ? toolData.output.message : formatToolData(toolData.output);
        
        const outputLabel = document.createElement('div');
        outputLabel.className = 'tool-section-label';
        outputLabel.textContent = outputLabelText;
        
        const outputContent = document.createElement('div');
        outputContent.className = 'tool-section-content';
        outputContent.textContent = outputContentText;
        
        outputSection.appendChild(outputLabel);
        outputSection.appendChild(outputContent);
        details.appendChild(outputSection);
        card.dataset.hasOutput = 'true';
    }
}

function clearAllToolCards() {
    floatingToolCards.forEach((card) => {
        if (card && card.parentNode) {
            card.parentNode.removeChild(card);
        }
    });
    floatingToolCards.clear();
    pendingToolUses = [];
}

// No longer needed - remove the constant re-appending
function ensureToolCardAtBottom() {
    // Do nothing - cards stay where they are
}

function scrollToBottom() {
    chatContainer.scrollTo({
        top: chatContainer.scrollHeight,
        behavior: 'smooth'
    });
}

function updateChatUI() {
    if (!chatContainer) return;

    // Remove thinking indicators before updating
    hideUserThinkingIndicator();
    hideAssistantThinkingIndicator();

    // If chat was reset (fewer messages than rendered), clear and re-render
    if (chat.history.length < renderedMessageCount) {
        chatContainer.innerHTML = '';
        renderedMessageCount = 0;
    }

    // Check if the last message was updated (same count but content changed)
    if (chat.history.length === renderedMessageCount && renderedMessageCount > 0) {
        const lastItem = chat.history[chat.history.length - 1];
        
        // Handle tool card updates
        if (lastItem.type === 'tool') {
            const existingCard = chatContainer.querySelector(`.tool-card[data-tool-use-id="${lastItem.toolUseId}"]`);
            if (existingCard) {
                updateToolCard(existingCard, lastItem);
            }
        } else {
            // Update the last message element's content
            const messageElements = chatContainer.querySelectorAll('.message:not(.system):not(.thinking)');
            const lastMessageEl = messageElements[messageElements.length - 1];
            if (lastMessageEl && lastItem.role) {
                const contentEl = lastMessageEl.querySelector('.message-content');
                if (contentEl) {
                    // Update text content
                    contentEl.textContent = lastItem.message || "";
                    
                    // Add interrupted indicator if needed
                    if (lastItem.role.toLowerCase() === 'assistant' && lastItem.interrupted) {
                        const existingIndicator = contentEl.querySelector('.interrupted-indicator');
                        if (!existingIndicator) {
                            const interruptedSpan = document.createElement('div');
                            interruptedSpan.className = 'interrupted-indicator';
                            interruptedSpan.textContent = '(interrupted)';
                            contentEl.appendChild(interruptedSpan);
                        }
                    }
                }
            }
        }
    } else {
        // Only render new messages (incremental update)
        const newMessages = chat.history.slice(renderedMessageCount);
        
        newMessages.forEach((item, idx) => {
            const messageEl = createMessageElement(item, renderedMessageCount + idx);
            if (messageEl) {
                chatContainer.appendChild(messageEl);
            }
        });
        
        renderedMessageCount = chat.history.length;
    }

    // Also check for any tool cards that need updating (status change from running to completed)
    chat.history.forEach(item => {
        if (item.type === 'tool' && item.status === 'completed') {
            const existingCard = chatContainer.querySelector(`.tool-card[data-tool-use-id="${item.toolUseId}"]`);
            if (existingCard && !existingCard.dataset.completed) {
                updateToolCard(existingCard, item);
                existingCard.dataset.completed = 'true';
            }
        }
    });

    // Check for any assistant messages that need interrupted indicator
    const messageElements = chatContainer.querySelectorAll('.message.assistant:not(.thinking)');
    chat.history.forEach((item, index) => {
        if (item.role?.toLowerCase() === 'assistant' && item.interrupted) {
            // Find the corresponding message element
            let assistantIndex = 0;
            for (let i = 0; i <= index; i++) {
                if (chat.history[i].role?.toLowerCase() === 'assistant') {
                    assistantIndex++;
                }
            }
            const messageEl = messageElements[assistantIndex - 1];
            if (messageEl) {
                const contentEl = messageEl.querySelector('.message-content');
                if (contentEl && !contentEl.querySelector('.interrupted-indicator')) {
                    const interruptedSpan = document.createElement('div');
                    interruptedSpan.className = 'interrupted-indicator';
                    interruptedSpan.textContent = '(interrupted)';
                    contentEl.appendChild(interruptedSpan);
                }
            }
        }
    });

    // Re-add thinking indicators if needed
    if (waitingForAssistantResponse) showAssistantThinkingIndicator();

    scrollToBottom();
}

function updateToolCard(card, item) {
    // Update status
    const status = card.querySelector('.tool-status');
    if (status && item.status === 'completed') {
        status.className = 'tool-status completed';
        status.textContent = '';
        const elapsed = item.elapsed ? formatElapsed(item.elapsed) : '';
        
        const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        checkSvg.setAttribute('class', 'tool-check');
        checkSvg.setAttribute('viewBox', '0 0 24 24');
        checkSvg.setAttribute('fill', 'none');
        checkSvg.setAttribute('stroke', 'currentColor');
        checkSvg.setAttribute('stroke-width', '2');
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', '20 6 9 17 4 12');
        checkSvg.appendChild(polyline);
        
        const elapsedSpan = document.createElement('span');
        elapsedSpan.className = 'tool-elapsed';
        elapsedSpan.textContent = elapsed;
        
        status.appendChild(checkSvg);
        status.appendChild(elapsedSpan);
    }

    // Add output section if not present
    const details = card.querySelector('.tool-details');
    if (details && item.output !== undefined && !details.querySelector('.tool-section:nth-child(2)')) {
        const outputSection = document.createElement('div');
        outputSection.className = 'tool-section';
        
        const outputLabel = document.createElement('div');
        outputLabel.className = 'tool-section-label';
        outputLabel.textContent = 'Output';
        
        const outputContent = document.createElement('div');
        outputContent.className = 'tool-section-content';
        outputContent.textContent = formatToolData(item.output);
        
        outputSection.appendChild(outputLabel);
        outputSection.appendChild(outputContent);
        details.appendChild(outputSection);
    }
}

function clearChatUI() {
    chatContainer.innerHTML = '';
    renderedMessageCount = 0;
    clearAllToolCards();
}

function showUserThinkingIndicator() {
    hideUserThinkingIndicator();
    waitingForUserTranscription = true;

    userThinkingIndicator = document.createElement('div');
    userThinkingIndicator.className = 'message user thinking';

    const listeningText = document.createElement('div');
    listeningText.className = 'thinking-text';
    listeningText.textContent = 'Listening';
    userThinkingIndicator.appendChild(listeningText);

    const dotContainer = document.createElement('div');
    dotContainer.className = 'thinking-dots';
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        dotContainer.appendChild(dot);
    }
    userThinkingIndicator.appendChild(dotContainer);

    chatContainer.appendChild(userThinkingIndicator);
    scrollToBottom();
}

function showAssistantThinkingIndicator() {
    hideAssistantThinkingIndicator();
    waitingForAssistantResponse = true;

    assistantThinkingIndicator = document.createElement('div');
    assistantThinkingIndicator.className = 'message assistant thinking';

    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'message-icon';
    iconWrapper.appendChild(createNovaIcon());
    assistantThinkingIndicator.appendChild(iconWrapper);

    const thinkingText = document.createElement('div');
    thinkingText.className = 'thinking-text';
    thinkingText.textContent = 'Thinking';
    assistantThinkingIndicator.appendChild(thinkingText);

    const dotContainer = document.createElement('div');
    dotContainer.className = 'thinking-dots';
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        dotContainer.appendChild(dot);
    }
    assistantThinkingIndicator.appendChild(dotContainer);

    chatContainer.appendChild(assistantThinkingIndicator);
    scrollToBottom();
}

function hideUserThinkingIndicator() {
    waitingForUserTranscription = false;
    if (userThinkingIndicator && userThinkingIndicator.parentNode) {
        userThinkingIndicator.parentNode.removeChild(userThinkingIndicator);
    }
    userThinkingIndicator = null;
}

function hideAssistantThinkingIndicator() {
    waitingForAssistantResponse = false;
    if (assistantThinkingIndicator && assistantThinkingIndicator.parentNode) {
        assistantThinkingIndicator.parentNode.removeChild(assistantThinkingIndicator);
    }
    assistantThinkingIndicator = null;
}

// Socket event handlers
socket.on('contentStart', (data) => {
    if (data.type === 'TEXT') {
        role = data.role;
        if (data.role === 'USER') {
            // Don't hide user thinking indicator here - wait for actual text
        } else if (data.role === 'ASSISTANT') {
            hideAssistantThinkingIndicator();
            let isSpeculative = false;
            try {
                if (data.additionalModelFields) {
                    const additionalFields = JSON.parse(data.additionalModelFields);
                    isSpeculative = additionalFields.generationStage === "SPECULATIVE";
                    displayAssistantText = isSpeculative;
                } else {
                    displayAssistantText = false;
                }
            } catch (e) {
                console.error("Error parsing additionalModelFields:", e);
            }
        }
    } else if (data.type === 'AUDIO') {
        // Don't re-show indicator here, it's already shown when recording starts
    }
});

socket.on('textOutput', (data) => {
    if (isSarvamLanguage(config.language)) {
        if (data.role?.toLowerCase() === 'user') {
            hideUserThinkingIndicator();
            transcriptionReceived = true;
            chatHistoryManager.finalizeUserTranscript(data.content, currentTurnLanguage);
            currentTurnLanguage = null;
            showAssistantThinkingIndicator();
        } else if (data.role?.toLowerCase() === 'assistant') {
            hideAssistantThinkingIndicator();
            
            // Disappear KB inline indicator when assistant starts responding
            if (currentKBIndicator) {
                currentKBIndicator.classList.add('fade-out');
                const temp = currentKBIndicator;
                setTimeout(() => temp.remove(), 500);
                currentKBIndicator = null;
            }
            
            handleTextOutput({ role: 'ASSISTANT', content: data.content });
        }
        return;
    }

    if (data.role?.toLowerCase() === 'user') {
        hideUserThinkingIndicator();
        transcriptionReceived = true;
        handleTextOutput({ role: data.role, content: data.content });
        showAssistantThinkingIndicator();
    } else if (data.role?.toLowerCase() === 'assistant') {
        // Only show speculative text (real-time), skip final text (avoid duplicates)
        if (displayAssistantText) {
            handleTextOutput({ role: data.role, content: data.content });
        }
    }
});

socket.on('audioOutput', (data) => {
    if (!isAssistantSpeaking) {
        isAssistantSpeaking = true;
        assistantSpeakStartTime = Date.now();
        stopSpeechRecognition();
    }
    if (data.content) {
        try {
            const audioData = base64ToFloat32Array(data.content);
            audioPlayer.playAudio(audioData);

            // Calculate this chunk's duration based on sample rate
            const chunkDuration = (audioData.length / config.outputSampleRate) * 1000; // in ms
            
            // Track speech start time and accumulate total duration
            if (speechStartTime === 0) {
                speechStartTime = Date.now();
                totalAudioDuration = 0;
                // Reset fade state when new speech starts
                isRingFadingOut = false;
                ringFadeAlpha = 1;
            }
            totalAudioDuration += chunkDuration;

            // Update waveform with assistant audio output level (circular wave)
            let sum = 0;
            for (let i = 0; i < audioData.length; i++) {
                sum += audioData[i] * audioData[i];
            }
            const rms = Math.sqrt(sum / audioData.length);
            updateAssistantAudioLevel(rms);
            
            // Clear any existing fade timer
            if (audioFadeTimer) {
                clearTimeout(audioFadeTimer);
                audioFadeTimer = null;
            }
        } catch (error) {
            console.error('Error processing audio data:', error);
        }
    }
});

socket.on('contentEnd', (data) => {
    if (data.type === 'TEXT') {
        if (role === 'USER') {
            hideUserThinkingIndicator();
            showAssistantThinkingIndicator();
        } else if (role === 'ASSISTANT') {
            hideAssistantThinkingIndicator();
        }

        if (data.stopReason?.toUpperCase() === 'END_TURN') {
            // Clear pending tools - they're already displayed as floating cards
            // No need to re-add to history, just clear the tracking array
            pendingToolUses = [];
            chatHistoryManager.endTurn();
        } else if (data.stopReason?.toUpperCase() === 'INTERRUPTED') {
            bargeInCooldownEndTime = Date.now() + 600;
            audioPlayer.bargeIn();
            chatHistoryManager.markLastAssistantInterrupted();
            isAssistantSpeaking = false;
            isWaitingForResponse = false;
            if (isStreaming) {
                setTimeout(() => {
                    if (isStreaming && !isAssistantSpeaking && Date.now() >= bargeInCooldownEndTime) {
                        startSpeechRecognition();
                    }
                }, 500);
            }
            
            // Immediately stop the ring animation on interruption
            if (audioFadeTimer) {
                clearTimeout(audioFadeTimer);
                audioFadeTimer = null;
            }
            isRingFadingOut = true;
            targetAssistantAudioLevel = 0;
            assistantAudioLevel = 0;
            speechStartTime = 0;
            totalAudioDuration = 0;
        }
    } else if (data.type === 'AUDIO') {
        // Prevent double triggering if already fading
        if (isRingFadingOut) {
            console.log('Audio contentEnd: already fading, skipping');
            return;
        }
        
        // Calculate remaining playback time: totalDuration - elapsed since speech started
        // Add buffer offset based on configured audio buffer size
        const audioBufferDelay = config.audioBufferMs;
        const elapsedSinceSpeechStart = Date.now() - speechStartTime;
        const remainingPlayback = Math.max(0, totalAudioDuration + audioBufferDelay - elapsedSinceSpeechStart);
        
        console.debug(`Audio contentEnd: totalDuration=${totalAudioDuration}ms, elapsed=${elapsedSinceSpeechStart}ms, remaining=${remainingPlayback}ms`);
        
        // Clear any existing timer
        if (audioFadeTimer) {
            clearTimeout(audioFadeTimer);
        }
        
        // Start gradual fade out after remaining audio finishes
        audioFadeTimer = setTimeout(() => {
            console.debug(`Starting ring fade out, current assistantAudioLevel=${assistantAudioLevel}, ringFadeAlpha=${ringFadeAlpha}`);
            isAssistantSpeaking = false;
            isWaitingForResponse = false;
            
            // Trigger the ring fade out animation
            isRingFadingOut = true;
            targetAssistantAudioLevel = 0;
            
            if (isStreaming) {
                startSpeechRecognition();
            }
            
            // Reset tracking after fade completes
            setTimeout(() => {
                speechStartTime = 0;
                totalAudioDuration = 0;
                audioFadeTimer = null;
                console.debug('Fade out complete');
            }, 1500);
        }, remainingPlayback);
    }
});

socket.on('bargeIn', (data) => {
    console.log('Barge-in event received:', data);
    bargeInCooldownEndTime = Date.now() + 600;
    audioPlayer.bargeIn();
    chatHistoryManager.markLastAssistantInterrupted();
    isAssistantSpeaking = false;
    isWaitingForResponse = false;
    
    if (isStreaming) {
        setTimeout(() => {
            if (isStreaming && !isAssistantSpeaking && Date.now() >= bargeInCooldownEndTime) {
                startSpeechRecognition();
            }
        }, 500);
    }
    
    // Immediately stop the ring animation on barge-in
    if (audioFadeTimer) {
        clearTimeout(audioFadeTimer);
        audioFadeTimer = null;
    }
    isRingFadingOut = true;
    targetAssistantAudioLevel = 0;
    speechStartTime = 0;
    totalAudioDuration = 0;
});

socket.on('toolUse', (data) => {
    console.log('Tool use event received:', data);
    hideAssistantThinkingIndicator();
    
    if (data.toolName === 'search_knowledge_base') {
        const kbBadge = document.getElementById('status-kb-badge');
        const kbValue = document.getElementById('status-kb-value');
        if (kbBadge && kbValue) {
            kbBadge.className = 'status-badge kb-calling';
            kbValue.textContent = 'Searching...';
        }
        
        // Remove existing indicator if any
        if (currentKBIndicator) {
            currentKBIndicator.remove();
        }
        
        // Add new temporary inline indicator between speech bubbles
        currentKBIndicator = document.createElement('div');
        currentKBIndicator.className = 'kb-inline-indicator';
        currentKBIndicator.innerHTML = `
            <span class="kb-inline-spinner"></span>
            <span class="kb-inline-text">Searching in Knowledge Base...</span>
        `;
        chatContainer.appendChild(currentKBIndicator);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
    
    // Parse content if it's a JSON string
    let inputData = data.content;
    if (typeof inputData === 'string') {
        try {
            inputData = JSON.parse(inputData);
        } catch (e) {
            // Keep as string if not valid JSON
        }
    }
    
    // Create tool data
    const toolData = {
        toolUseId: data.toolUseId,
        toolName: data.toolName,
        input: inputData || {},
        startTime: Date.now(),
        status: 'running'
    };
    
    // Add to pending tools array
    pendingToolUses.push(toolData);
    
    // Add to chat history so it renders in the chat log
    chatHistoryManager.addToolUse(toolData);
});

socket.on('toolResult', (data) => {
    console.log('Tool result event received:', data);
    
    // Find and update the matching pending tool
    const toolIndex = pendingToolUses.findIndex(t => t.toolUseId === data.toolUseId);
    if (toolIndex !== -1) {
        const tool = pendingToolUses[toolIndex];
        tool.output = data.result;
        tool.endTime = Date.now();
        // Use server-provided execution time if available, otherwise calculate from client timestamps
        tool.elapsed = data.executionTimeMs || (tool.endTime - tool.startTime);
        tool.status = 'completed';
        
        // Update the tool card inside chat history
        chatHistoryManager.updateToolResult(data.toolUseId, data.result);
        
        if (tool.toolName === 'search_knowledge_base') {
            const kbBadge = document.getElementById('status-kb-badge');
            const kbValue = document.getElementById('status-kb-value');
            if (kbBadge && kbValue) {
                kbBadge.className = 'status-badge active';
                kbValue.textContent = 'Found Info';
                setTimeout(() => {
                    if (kbValue.textContent === 'Found Info') {
                        kbValue.textContent = 'Ready';
                    }
                }, 3000);
            }
            
            // Transition inline indicator to completed, then schedule disappearance
            if (currentKBIndicator) {
                currentKBIndicator.className = 'kb-inline-indicator completed';
                currentKBIndicator.innerHTML = `
                    <span class="kb-inline-check">✓</span>
                    <span class="kb-inline-text">Searched in Knowledge Base</span>
                `;
                
                setTimeout(() => {
                    if (currentKBIndicator) {
                        currentKBIndicator.classList.add('fade-out');
                        const temp = currentKBIndicator;
                        setTimeout(() => temp.remove(), 500);
                        currentKBIndicator = null;
                    }
                }, 2500);
            }
        }
    }
    
    showAssistantThinkingIndicator();
});

socket.on('languageDetected', (data) => {
    console.log('Language detected:', data);
    
    // Store detected language in global variable for user message binding
    currentTurnLanguage = data.languageName;
    
    const langKey = data.languageName.toLowerCase();
    if (config.language !== langKey) {
        config.language = langKey;
        setCustomSelectValue('language-select', langKey);
        saveConfig();
        // Dynamic SpeechRecognition language switch
        if (isStreaming && !isAssistantSpeaking) {
            console.log('[SpeechRecognition] Restarting in new language:', langKey);
            startSpeechRecognition();
        }
    }
    
    const langValue = document.getElementById('status-language-value');
    if (langValue) {
        langValue.textContent = data.languageName;
    }
});

socket.on('sarvamReady', () => { console.log('[Sarvam] Ready'); });
socket.on('sarvamDone', () => { 
    console.log('[Sarvam] Done'); 
    window._sarvamSpeaking = false; 
    isWaitingForResponse = false; 
    if (isStreaming && !isAssistantSpeaking) {
        startSpeechRecognition();
    }
});

socket.on('streamComplete', () => {
    if (isStreaming) stopStreaming();
});

socket.on('streamInterrupted', (data) => {
    console.log('Stream interrupted (recoverable):', data);
    // Don't stop streaming - audio might still be playing
    // Just log it for debugging
});

socket.on('connect', () => {
    sessionInitialized = false;
});

socket.on('disconnect', () => {
    if (manualDisconnect) {
        manualDisconnect = false;
    } else {
        if (isStreaming) {
            stopStreaming();
        }
    }
    sessionInitialized = false;
    hideUserThinkingIndicator();
    hideAssistantThinkingIndicator();
    stopWaveformAnimation();
});

socket.on('error', (error) => {
    console.error("Server error:", error);
    hideUserThinkingIndicator();
    hideAssistantThinkingIndicator();
    isWaitingForResponse = false;
    if (isStreaming && !isAssistantSpeaking) {
        startSpeechRecognition();
    }
    
    // Handle stream errors from AWS - stop conversation and show error
    if (error?.source === 'responseStream' && error?.details) {
        console.log('Stream error detected, stopping conversation');
        if (isStreaming) {
            stopStreaming();
        }
        const errorDiv = document.createElement('div');
        errorDiv.className = 'message system';
        const warningIcon = document.createElement('span');
        warningIcon.className = 'warning-icon';
        warningIcon.textContent = '⚠️';
        errorDiv.appendChild(warningIcon);
        errorDiv.appendChild(document.createTextNode(' ' + error.details));
        chatContainer.appendChild(errorDiv);
        scrollToBottom();
        return;
    }
    
    // Stop streaming if session is no longer active
    if (error?.message === 'No active session for audio input' && isStreaming) {
        console.log('Session closed, stopping audio capture');
        stopStreaming();
    }
});

// Voice button handler
voiceBtn.addEventListener('click', () => {
    if (isInitializing) {
        console.log('Already initializing/connecting, ignoring click.');
        return;
    }
    if (isStreaming) {
        stopStreaming();
    } else {
        startStreaming();
    }
});

// Window resize handler for canvas
window.addEventListener('resize', () => {
    if (isAnimating) {
        initWaveformCanvas();
    }
});

// Expose variables for typing.js
window.socket = socket;
window.showAssistantThinkingIndicator = showAssistantThinkingIndicator;
window.chatHistoryManager = chatHistoryManager;
Object.defineProperty(window, 'sessionInitialized', {
    get: () => sessionInitialized
});

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    await initSettings();
    initWaveformCanvas();
    
    // Auto-start if language parameter is in URL
    const urlParams = new URLSearchParams(window.location.search);
    const language = urlParams.get('language');
    const autoStart = urlParams.get('autostart') !== 'false';
    
    if (language) {
        config.language = language.toLowerCase();
        setCustomSelectValue('language-select', config.language);
    }
    
    if (language && autoStart) {
        console.log('[AUTO-START] Starting conversation with', language);
        setTimeout(() => {
            if (!isStreaming) {
                voiceBtn.click();
            }
        }, 500);
    }
});
