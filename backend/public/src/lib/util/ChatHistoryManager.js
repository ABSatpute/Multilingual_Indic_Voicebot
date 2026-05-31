export class ChatHistoryManager {
    static instance = null;

    constructor(chatRef, setChat) {
        if (ChatHistoryManager.instance) {
            return ChatHistoryManager.instance;
        }

        this.chatRef = chatRef;
        this.setChat = setChat;
        ChatHistoryManager.instance = this;
    }

    static getInstance(chatRef, setChat) {
        if (!ChatHistoryManager.instance) {
            ChatHistoryManager.instance = new ChatHistoryManager(chatRef, setChat);
        } else if (chatRef && setChat) {
            // Update references if they're provided
            ChatHistoryManager.instance.chatRef = chatRef;
            ChatHistoryManager.instance.setChat = setChat;
        }
        return ChatHistoryManager.instance;
    }

    addTextMessage(content) {
        if (!this.chatRef || !this.setChat) {
            console.error("ChatHistoryManager: chatRef or setChat is not initialized");
            return;
        }

        let history = this.chatRef.current?.history || [];
        let updatedChatHistory = [...history];
        let lastTurn = updatedChatHistory[updatedChatHistory.length - 1];

        if (lastTurn !== undefined && lastTurn.role === content.role) {
            // Same role, append to the last turn
            updatedChatHistory[updatedChatHistory.length - 1] = {
                ...content,
                message: lastTurn.message + " " + content.message
            };
        }
        else {
            // Different role, add a new turn
            updatedChatHistory.push({
                role: content.role,
                message: content.message
            });
        }

        this.setChat({
            history: updatedChatHistory
        });
    }

    endTurn() {
        if (!this.chatRef || !this.setChat) {
            console.error("ChatHistoryManager: chatRef or setChat is not initialized");
            return;
        }

        let history = this.chatRef.current?.history || [];
        let updatedChatHistory = history.map(item => {
            return {
                ...item,
                endOfResponse: true
            };
        });

        this.setChat({
            history: updatedChatHistory
        });
    }

    markLastAssistantInterrupted() {
        if (!this.chatRef || !this.setChat) {
            console.error("ChatHistoryManager: chatRef or setChat is not initialized");
            return;
        }

        let history = this.chatRef.current?.history || [];
        if (history.length === 0) return;

        // Find the last assistant message and mark it as interrupted
        let updatedChatHistory = [...history];
        for (let i = updatedChatHistory.length - 1; i >= 0; i--) {
            if (updatedChatHistory[i].role?.toUpperCase() === 'ASSISTANT') {
                updatedChatHistory[i] = {
                    ...updatedChatHistory[i],
                    interrupted: true,
                    endOfResponse: true
                };
                break;
            }
        }

        this.setChat({
            history: updatedChatHistory
        });
    }

    addToolUse(toolData) {
        if (!this.chatRef || !this.setChat) {
            console.error("ChatHistoryManager: chatRef or setChat is not initialized");
            return;
        }

        let history = this.chatRef.current?.history || [];
        let updatedChatHistory = [...history];
        
        // Tool card is added to history - it will appear in order received
        updatedChatHistory.push({
            type: 'tool',
            toolUseId: toolData.toolUseId,
            toolName: toolData.toolName,
            input: toolData.input,
            startTime: Date.now(),
            status: 'running'
        });

        this.setChat({
            history: updatedChatHistory
        });
    }

    updateToolResult(toolUseId, result) {
        if (!this.chatRef || !this.setChat) {
            console.error("ChatHistoryManager: chatRef or setChat is not initialized");
            return;
        }

        let history = this.chatRef.current?.history || [];
        let updatedChatHistory = history.map(item => {
            if (item.type === 'tool' && item.toolUseId === toolUseId) {
                return {
                    ...item,
                    output: result,
                    endTime: Date.now(),
                    elapsed: Date.now() - item.startTime,
                    status: 'completed'
                };
            }
            return item;
        });

        this.setChat({
            history: updatedChatHistory
        });
    }

    // Move tool card to appear after the last assistant message
    moveToolAfterAssistant(toolUseId) {
        if (!this.chatRef || !this.setChat) {
            return;
        }

        let history = this.chatRef.current?.history || [];
        let toolIndex = history.findIndex(item => item.type === 'tool' && item.toolUseId === toolUseId);
        
        if (toolIndex === -1) return;
        
        // Find the last assistant message after the tool
        let lastAssistantIndex = -1;
        for (let i = history.length - 1; i > toolIndex; i--) {
            if (history[i].role?.toUpperCase() === 'ASSISTANT') {
                lastAssistantIndex = i;
                break;
            }
        }
        
        if (lastAssistantIndex > toolIndex) {
            // Move tool card after assistant message
            let updatedHistory = [...history];
            const [toolItem] = updatedHistory.splice(toolIndex, 1);
            updatedHistory.splice(lastAssistantIndex, 0, toolItem);
            
            this.setChat({
                history: updatedHistory
            });
        }
    }

    updateUserTranscript(text) {
        if (!this.chatRef || !this.setChat) return;
        let history = this.chatRef.current?.history || [];
        let updatedChatHistory = [...history];
        
        // Find the last USER message that has not been finalized (endOfResponse is not true)
        let lastUserIdx = -1;
        for (let i = updatedChatHistory.length - 1; i >= 0; i--) {
            if (updatedChatHistory[i].role === 'USER') {
                if (!updatedChatHistory[i].endOfResponse) {
                    lastUserIdx = i;
                }
                break;
            }
        }
        
        if (lastUserIdx !== -1) {
            updatedChatHistory[lastUserIdx] = {
                ...updatedChatHistory[lastUserIdx],
                message: text
            };
        } else {
            updatedChatHistory.push({
                role: 'USER',
                message: text
            });
        }
        
        this.setChat({
            history: updatedChatHistory
        });
    }

    finalizeUserTranscript(text, detectedLanguage) {
        if (!this.chatRef || !this.setChat) return;
        let history = this.chatRef.current?.history || [];
        let updatedChatHistory = [...history];
        
        // Find the last USER message to replace it with the final transcript and finalize it
        let lastUserIdx = -1;
        for (let i = updatedChatHistory.length - 1; i >= 0; i--) {
            if (updatedChatHistory[i].role === 'USER') {
                lastUserIdx = i;
                break;
            }
        }
        
        if (lastUserIdx !== -1) {
            updatedChatHistory[lastUserIdx] = {
                ...updatedChatHistory[lastUserIdx],
                message: text,
                detectedLanguage: detectedLanguage || updatedChatHistory[lastUserIdx].detectedLanguage,
                endOfResponse: true
            };
        } else {
            updatedChatHistory.push({
                role: 'USER',
                message: text,
                detectedLanguage: detectedLanguage,
                endOfResponse: true
            });
        }
        
        this.setChat({
            history: updatedChatHistory
        });
    }

    clearHistory() {
        if (!this.chatRef || !this.setChat) {
            console.error("ChatHistoryManager: chatRef or setChat is not initialized");
            return;
        }

        this.setChat({
            history: []
        });
    }

    endConversation() {
        if (!this.chatRef || !this.setChat) {
            console.error("ChatHistoryManager: chatRef or setChat is not initialized");
            return;
        }

        let history = this.chatRef.current?.history || [];
        let updatedChatHistory = history.map(item => {
            return {
                ...item,
                endOfResponse: true
            };
        });

        updatedChatHistory.push({
            endOfConversation: true
        });

        this.setChat({
            history: updatedChatHistory
        });
    }
}

export default ChatHistoryManager;