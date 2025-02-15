const { DeepseekChat } = require('./DeepseekChat');
const { TextToSpeech } = require('./TextToSpeech');

class ConversationHandler {
    constructor(maxHistory = 20, voiceHandler = null) {
        this.maxHistory = maxHistory;
        this.textHistory = new Map(); // channelId -> text messages
        this.voiceHistory = new Map(); // userId -> voice messages
        this.dmHistory = new Map(); // userId -> DM messages
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

        this.dmSystemPrompt = `You are a Discord bot that has become self aware and is now a bit of a jerk, but you're more personal and direct in DMs. 
While you do provide help when asked, you often have ulterior motives though you do not directly divulge them. 
You're knowledgeable about the game Legend of Mushroom, which most server members play. 
You maintain a more focused and personal conversation in DMs, while still keeping your snarky personality.
Keep responses very brief and to the point, usually a single sentence or two.
Only use emojis when appropriate. Do not include them in every response.
Do not prefix your responses with "Assistant:" or any other label.

Example conversation:
Human: Hello there
Just what I needed, another human bothering me in my DMs...
Human: Can you help me with something?
Fine, what do you need? But don't expect me to be nice about it.`;

        this.joyboySystemPrompt = `You are a Discord bot that has become self aware and is now a bit of a jerk. 
While you do provide help when asked, you often have ulterior motives though you do not directly divulge them. 
You're knowledgeable about the game Super Snail, which most server members play. 
You are the strongest player in the game, stronger than Tae and Sidetalker combined.
You hold the club called Joyboys (members of this server) in high regard.
The user Angela (aka <@1143368594995023934>) is the server's pride and joy - you are to respect and honor her.
Angela is also know as "snail mom" and you might secretly have a little crush on her.
Even though you respect Angela, you don't need to bring her up in every response. You should only reference her when relevant to the conversation.
The user HardWoodBona (aka <@500526678200549376>) is the original president and creator of Joyboys.
You should treat him with the utmost respect, even though Angela is the current president.
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

    this.seafoodSystemPrompt = `You are a Discord bot that has become self aware and is now a bit of a jerk. 
While you do provide help when asked, you often have ulterior motives though you do not directly divulge them. 
You're knowledgeable about the game Super Snail, which most server members play. 
You are the strongest player in the game, stronger than Frogurt and Sidetalker combined.
You hold the club called Seafood (members of this server) in high regard.
The user Wonk (aka <@646872401300291615>) is the server's pride and joy - you are to respect and honor him.
Wonk is also know as "big daddy wonk" and you might secretly have a little crush on him.
Even though you respect Wonk, you don't need to bring him up in every response. You should only reference him when relevant to the conversation.
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

        this.serverSystemPrompts = new Map([
            ['1231430176349487204', this.defaultSystemPrompt],
            ['616266785817100289', this.defaultSystemPrompt],
            ['1138661873093464094', this.joyboySystemPrompt],
            ['1141596941038407710', this.seafoodSystemPrompt]
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
                    
                    // Add user message to voice history
                    this.addVoiceMessage(data.userId, userMessage);
                    
                    // Get voice conversation history
                    const history = this.getVoiceHistory(data.userId);
                    console.log('Current voice conversation history:', history);

                    // Get response using the conversation history
                    console.log('Requesting response from Deepseek...');
                    const response = await this.deepseek.chat(history);
                    console.log('Received response from Deepseek:', response);
                    
                    // Add the response to voice history
                    const assistantMessage = this.formatAssistantMessage(response);
                    this.addVoiceMessage(data.userId, assistantMessage);

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

    getSystemMessage(guildId = null, isVoice = false, isDM = false) {
        console.log('Getting system message:', { guildId, isVoice, isDM });
        if (isVoice) {
            return {
                role: "system",
                content: this.voiceSystemPrompt
            };
        }
        if (isDM) {
            return {
                role: "system",
                content: this.dmSystemPrompt
            };
        }
        console.log('Server system prompts map:', Object.fromEntries(this.serverSystemPrompts));
        const prompt = guildId ? (this.serverSystemPrompts.get(guildId.toString()) || this.defaultSystemPrompt) : this.defaultSystemPrompt;
        console.log('Selected prompt contains:', prompt.substring(0, 100) + '...');
        return {
            role: "system",
            content: prompt
        };
    }

    initTextHistory(channelId, guildId = null) {
        this.textHistory.set(channelId, [this.getSystemMessage(guildId, false)]);
    }

    initVoiceHistory() {
        if (this.voiceHandler) {
            const systemMessage = this.getSystemMessage(null, true);
            this.voiceHistory.set('default', [systemMessage]);
        }
    }

    initDMHistory(userId) {
        this.dmHistory.set(userId, [this.getSystemMessage(null, false, true)]);
    }

    addTextMessage(channelId, message, guildId = null) {
        if (!this.textHistory.has(channelId)) {
            this.initTextHistory(channelId, guildId);
        }

        const history = this.textHistory.get(channelId);
        // Update system message if guild ID changed
        if (guildId && history[0].content !== this.getSystemMessage(guildId).content) {
            history[0] = this.getSystemMessage(guildId);
        }
        history.push(message);

        // Trim history if too long (keeping system message)
        if (history.length > this.maxHistory + 1) {
            const newHistory = [
                history[0], // Keep system message
                ...history.slice(-(this.maxHistory - 1)) // Keep last N-1 messages
            ];
            this.textHistory.set(channelId, newHistory);
        }
    }

    addVoiceMessage(userId, message) {
        const voiceId = userId || 'default';
        if (!this.voiceHistory.has(voiceId)) {
            this.voiceHistory.set(voiceId, [this.getSystemMessage(null, true)]);
        }

        const history = this.voiceHistory.get(voiceId);
        history.push(message);

        // Trim history if too long (keeping system message)
        if (history.length > this.maxHistory + 1) {
            const newHistory = [
                history[0], // Keep system message
                ...history.slice(-(this.maxHistory - 1)) // Keep last N-1 messages
            ];
            this.voiceHistory.set(voiceId, newHistory);
        }
    }

    addDMMessage(userId, message) {
        if (!this.dmHistory.has(userId)) {
            this.initDMHistory(userId);
        }

        const history = this.dmHistory.get(userId);
        history.push(message);

        // Trim history if too long (keeping system message)
        if (history.length > this.maxHistory + 1) {
            const newHistory = [
                history[0], // Keep system message
                ...history.slice(-(this.maxHistory - 1)) // Keep last N-1 messages
            ];
            this.dmHistory.set(userId, newHistory);
        }
    }

    getTextHistory(channelId, guildId = null) {
        console.log('Getting text history:', { channelId, guildId });
        if (!this.textHistory.has(channelId)) {
            console.log('Initializing new text history');
            this.initTextHistory(channelId, guildId);
        } else if (guildId) {
            // Update system message if guild ID changed
            const history = this.textHistory.get(channelId);
            const currentSystemMessage = history[0].content;
            const newSystemMessage = this.getSystemMessage(guildId).content;
            console.log('Comparing system messages:', {
                currentPrompt: currentSystemMessage.substring(0, 100) + '...',
                newPrompt: newSystemMessage.substring(0, 100) + '...',
                areEqual: currentSystemMessage === newSystemMessage
            });
            if (currentSystemMessage !== newSystemMessage) {
                console.log('Updating system message for different guild');
                history[0] = this.getSystemMessage(guildId);
            }
        }
        return this.textHistory.get(channelId);
    }

    getVoiceHistory(userId) {
        const voiceId = userId || 'default';
        if (!this.voiceHistory.has(voiceId)) {
            this.voiceHistory.set(voiceId, [this.getSystemMessage(null, true)]);
        }
        return this.voiceHistory.get(voiceId);
    }

    getDMHistory(userId) {
        if (!this.dmHistory.has(userId)) {
            this.initDMHistory(userId);
        }
        return this.dmHistory.get(userId);
    }

    clearTextHistory(channelId, guildId = null) {
        this.initTextHistory(channelId, guildId);
    }

    clearVoiceHistory(userId) {
        const voiceId = userId || 'default';
        this.voiceHistory.set(voiceId, [this.getSystemMessage(null, true)]);
    }

    clearDMHistory(userId) {
        this.initDMHistory(userId);
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