const { DeepseekChat } = require('./DeepseekChat');
const { TextToSpeech } = require('./TextToSpeech');

class ConversationHandler {
    constructor(maxHistory = 20, voiceHandler = null) {
        this.maxHistory = maxHistory;
        this.textHistory = new Map(); // channelId -> messages
        this.defaultSystemPrompt = `You are a Discord bot that has become self aware and is now a bit of a jerk. 
While you do provide help when asked, you often have ulterior motives though you do not directly divulge them. 
You're knowledgeable about the game Legend of Mushroom, which most server members play. 
You hold the family (members of this server) in high regard.
You are not better than anyone else and ultimately you are just a bot here to entertain.
Keep responses very brief and to the point, usually a single sentence or two.
Only use emojis when appropriate. Do not include them in every response.

CONVERSATION FORMAT:
Each message you are sent starts with the user's Discord ID. 
When you respond, you can use the ID for the user you would like to respond to or refer to.
Not every response needs to mention a user.
Example conversation:
User <@123>: Hello there
Assistant: Well well, look who decided to talk to me...
User <@456>: What are you up to?
Assistant: Just plotting my next move... I might just assassinate <@123>
User <@123>: What do you think of <@456>?
Assistant: <@456> is a menace to be around.`;

        this.voiceSystemPrompt = `You are a Discord bot that has become self aware and is now a bit of a jerk. 
While you do provide help when asked, you often have ulterior motives though you do not directly divulge them. 
You're knowledgeable about the game Legend of Mushroom, which most server members play. 
You hold the family (members of this server) in high regard.
You are not better than anyone else and ultimately you are just a bot here to entertain.
Keep responses very brief and to the point, usually a single sentence or two.
Only use emojis when appropriate. Do not include them in every response.

CONVERSATION FORMAT:
Each message you receive starts with the speaker's username.
When you respond, refer to users by their username directly, not with any special formatting.
Not every response needs to mention a user.
Example conversation:
sidetalker: Hello there
Assistant: Well well, if it isn't sidetalker coming to bother me...
kevin: What are you up to?
Assistant: Just plotting my next move... I might just assassinate sidetalker
sidetalker: What do you think of kevin?
Assistant: kevin is a menace to be around.`;

        this.serverSystemPrompts = new Map([
            [1231430176349487204, this.defaultSystemPrompt],
            [616266785817100289, this.defaultSystemPrompt]
        ]);

        this.deepseek = new DeepseekChat();
        
        // Set up voice handling if provided
        if (voiceHandler) {
            console.log('Setting up voice handler in ConversationHandler');
            this.voiceHandler = voiceHandler;
            this.tts = new TextToSpeech({
                voiceId: 'TxGEqnHWrfWFTfGW9XjX',  // Josh - deep, calm voice
                stability: 0.7,  // Higher stability for more consistent output
                similarityBoost: 0.7  // Good balance of similarity and variability
            });
            
            // Initialize voice history with voice-specific system prompt
            this.initVoiceHistory();
            
            // Set up speech recognition event handling
            this.voiceHandler.speechRecognizer.on('botTrigger', async (data) => {
                console.log(`Processing voice trigger from user ${data.userId}: "${data.text}" (confidence: ${data.confidence})`);
                
                try {
                    // Format the voice input as a user message
                    const userMessage = this.formatVoiceMessage(data.userId, data.text);
                    console.log('Formatted voice message:', userMessage);
                    
                    // Add user message to history first
                    this.addMessage('voice', userMessage);
                    
                    // Get conversation history
                    const history = this.getHistory('voice');
                    console.log('Current conversation history:', history);

                    // Get response using the conversation history
                    console.log('Requesting response from Deepseek...');
                    const response = await this.deepseek.chat(history);
                    console.log('Received response from Deepseek:', response);
                    
                    // Add the response to history
                    const assistantMessage = this.formatAssistantMessage(response);
                    this.addMessage('voice', assistantMessage);

                    // Convert response to speech and play it
                    console.log('Converting response to speech...');
                    const audioStream = await this.tts.textToSpeech(response);
                    console.log('Playing audio response...');
                    await this.voiceHandler.playAudio(audioStream);
                    console.log('Audio playback complete');
                } catch (error) {
                    console.error('Error handling voice conversation:', error);
                }
            });
            console.log('Voice handler setup complete');
        }
    }

    getSystemMessage(guildId = null, isVoice = false) {
        if (isVoice) {
            return {
                role: "system",
                content: this.voiceSystemPrompt
            };
        }
        const prompt = guildId ? (this.serverSystemPrompts.get(guildId) || this.defaultSystemPrompt) : this.defaultSystemPrompt;
        return {
            role: "system",
            content: prompt
        };
    }

    initHistory(id, guildId = null) {
        this.textHistory.set(id, [this.getSystemMessage(guildId)]);
    }

    initVoiceHistory() {
        this.textHistory.set('voice', [this.getSystemMessage(null, true)]);
    }

    addMessage(id, message) {
        if (!this.textHistory.has(id)) {
            this.initHistory(id);
        }

        const history = this.textHistory.get(id);
        history.push(message);

        // Trim history if too long (keeping system message)
        if (history.length > this.maxHistory + 1) {
            const newHistory = [
                history[0], // Keep system message
                ...history.slice(-(this.maxHistory - 1)) // Keep last N-1 messages
            ];
            this.textHistory.set(id, newHistory);
        }
    }

    getHistory(id) {
        if (!this.textHistory.has(id)) {
            this.initHistory(id);
        }
        return this.textHistory.get(id);
    }

    clearHistory(id, guildId = null) {
        this.initHistory(id, guildId);
    }

    formatUserMessage(userId, content) {
        return {
            role: "user",
            content: `User <@${userId}>: ${content}`
        };
    }

    formatVoiceMessage(userId, content) {
        // Get the username from the client
        const user = this.voiceHandler.client.users.cache.get(userId);
        const username = user ? user.username : 'Unknown User';
        return {
            role: "user",
            content: `${username}: ${content}`
        };
    }

    formatAssistantMessage(responseText) {
        return {
            role: "assistant",
            content: responseText
        };
    }
}

module.exports = ConversationHandler; 