const { Client, GatewayIntentBits, Events, Collection, ChannelType, Routes } = require('discord.js');
const { OpenAI } = require('openai');
const dotenv = require('dotenv');
const ConversationHandler = require('./utils/ConversationHandler');
const VoiceHandler = require('./utils/VoiceHandler');
const { loadCommands } = require('./utils/commandLoader');
const { cleanup, restoreVoiceState } = require('./cleanup');

// Load environment variables
dotenv.config();

// Create Discord client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.MessageContent,  // Required for message content in DMs
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.GuildMessageReactions,
        32767  // All intents (temporary for testing)
    ],
    partials: [
        'CHANNEL',      // Required to receive DMs
        'MESSAGE',      // Required to receive messages
        'USER',         // Required for user partial info
        'GUILD_MEMBER', // Required for member info
        'REACTION',     // Required for message reactions
        'DM'           // Required specifically for DM channels
    ]
});

// Initialize OpenAI client
const ai = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_API_BASE
});

// Initialize voice handler
const voiceHandler = new VoiceHandler(client);
client.voiceHandler = voiceHandler;  // Attach to client

// Initialize conversation handler with voice capabilities
client.conversationHandler = new ConversationHandler(20, voiceHandler);

// Initialize commands collection
client.commands = new Collection();

// Load commands
loadCommands(client);

// Add ready event handler to log when bot is ready
client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is ready to receive messages!');
});

// Generate AI response for text chat
async function generateTextResponse(channelId, newMessage, isDM = false, userId = null) {
    console.log(`\n=== Generating ${isDM ? 'DM' : 'text'} response for ${isDM ? `user ${userId}` : `channel ${channelId}`} ===`);
    
    // Get conversation history
    const history = isDM 
        ? client.conversationHandler.getDMHistory(userId)
        : client.conversationHandler.getTextHistory(channelId);
    
    // Keep system message plus last N messages
    const messages = [
        history[0], // System message
        ...history.slice(Math.max(1, history.length - client.conversationHandler.maxHistory + 1)),
        newMessage
    ];
    
    // Log the context window
    console.log(`\n=== ${isDM ? 'DM' : 'Text'} Chat Context Window ===`);
    messages.forEach((msg, index) => {
        if (index === 0) {
            console.log('\n[System Message]');
            console.log(msg.content.split('\n').map(line => `  ${line}`).join('\n'));
        } else {
            console.log(`\n[${msg.role.charAt(0).toUpperCase() + msg.role.slice(1)} Message]`);
            console.log(`  ${msg.content}`);
        }
    });
    console.log('\n=== End Context Window ===\n');
    
    try {
        console.log('Sending request to DeepSeek API...');
        const response = await ai.chat.completions.create({
            model: "deepseek-chat",
            messages: messages,
            max_tokens: 1000,
            temperature: 0.7,
            user: newMessage.name
        });
        
        const responseText = response.choices[0].message.content;
        console.log('Received text response:', responseText);
        return responseText;
    } catch (error) {
        console.error("Error generating text response:", error);
        throw error;
    }
}

// Attach generateTextResponse to client so commands can use it
client.generateTextResponse = generateTextResponse;

// Message event handler
client.on(Events.MessageCreate, async message => {
    try {
        // Fetch the channel if it's partial
        if (message.channel?.partial) {
            await message.channel.fetch();
        }

        const isDM = message.channel.type === 1;

        // Ignore messages from bots (including our own messages)
        if (message.author.bot || (isDM && message.author.id === client.user.id)) return;
        
        console.log(`Received ${isDM ? 'DM' : 'server'} message:`, {
            content: message.content,
            channelType: message.channel.type,
            isDM: isDM,
            author: message.author.tag,
            guildId: message.guild?.id || 'None (DM)'
        });
        
        // Process commands if message starts with prefix
        if (message.content.startsWith('!')) {
            const args = message.content.slice(1).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();
            
            const command = client.commands.get(commandName);
            if (!command) return;
            
            try {
                await command.execute(message, args);
            } catch (error) {
                console.error(error);
                await message.reply('There was an error executing that command!');
            }
            return;
        }
        
        // Format the new message
        const newMessage = client.conversationHandler.formatUserMessage(message.author.id, message.content);
        
        // Generate response if message is in DM or bot is mentioned in server
        if (isDM || (!isDM && message.mentions.has(client.user))) {
            console.log('Preparing to respond to message...');
            await message.channel.sendTyping();
            
            try {
                // Add the user's message to appropriate history
                if (isDM) {
                    client.conversationHandler.addDMMessage(message.author.id, newMessage);
                } else {
                    client.conversationHandler.addTextMessage(message.channel.id, newMessage);
                }
                
                // Generate and get the response
                const responseText = await generateTextResponse(
                    message.channel.id,
                    newMessage,
                    isDM,
                    isDM ? message.author.id : null
                );
                
                // Add bot's response to appropriate history
                const assistantMessage = client.conversationHandler.formatAssistantMessage(responseText);
                if (isDM) {
                    client.conversationHandler.addDMMessage(message.author.id, assistantMessage);
                } else {
                    client.conversationHandler.addTextMessage(message.channel.id, assistantMessage);
                }
                
                // Split and send response if too long
                const maxLength = 1900;
                for (let i = 0; i < responseText.length; i += maxLength) {
                    const chunk = responseText.substring(i, i + maxLength);
                    await message.channel.send(chunk);
                }
            } catch (error) {
                console.error('Error processing message:', error);
                await message.reply(`Sorry <@${message.author.id}>, I encountered an error: ${error.message}`);
            }
        } else if (!isDM) {
            // If not generating a response and not in DM, just add the message to text history
            client.conversationHandler.addTextMessage(message.channel.id, newMessage);
        }
    } catch (error) {
        console.error('Error in message event handler:', error);
    }
});

// Debug event to check what events we're receiving
client.on('raw', packet => {
    if (packet.t === 'MESSAGE_CREATE') {
        const data = packet.d;
        console.log('Raw MESSAGE_CREATE event:', {
            channelID: data.channel_id,
            type: data.channel_type,
            content: data.content,
            author: data.author,
            timestamp: new Date().toISOString()
        });
        
        // Try to manually emit the message create event
        if (data.channel_type === 1) { // If it's a DM
            const channel = client.channels.cache.get(data.channel_id) || {
                id: data.channel_id,
                type: 1,
                partial: false,
                send: async (content) => {
                    const payload = typeof content === 'string' ? { content } : content;
                    return client.rest.post(Routes.channelMessages(data.channel_id), { body: payload });
                },
                sendTyping: async () => {
                    return client.rest.post(Routes.channelTyping(data.channel_id));
                },
                messages: new Collection(),
                client: client,
                isTextBased: () => true,
                isDMBased: () => true
            };
            
            const message = {
                id: data.id,
                content: data.content,
                author: {
                    ...data.author,
                    tag: `${data.author.username}#${data.author.discriminator}`,
                    bot: false
                },
                channel: channel,
                guild: null,
                type: data.type,
                partial: false,
                mentions: { has: () => false },
                reply: async (content) => channel.send(content)
            };
            
            console.log('Emitting constructed message event:', {
                content: message.content,
                author: message.author.tag,
                channelId: message.channel.id
            });
            
            client.emit(Events.MessageCreate, message);
        }
    }
});

// Add debug handler for all message events
client.on('debug', info => {
    console.log('Debug Info:', info);
});

// Add error handler
client.on('error', error => {
    console.error('Discord client error:', error);
});

// Set up cleanup handlers
cleanup(client);

// Log in to Discord
client.login(process.env.DISCORD_TOKEN); 