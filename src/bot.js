const { Client, GatewayIntentBits, Events, Collection } = require('discord.js');
const { OpenAI } = require('openai');
const dotenv = require('dotenv');
const ConversationHandler = require('./utils/ConversationHandler');
const VoiceHandler = require('./utils/VoiceHandler');
const { loadCommands } = require('./utils/commandLoader');
const { cleanup, restoreVoiceState } = require('./cleanup');

// Load environment variables
dotenv.config();

// Validate required environment variables
if (!process.env.DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN is required in environment variables');
}

// Initialize Discord client with required intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,  // Required for voice support
    ]
});

// Initialize OpenAI client for DeepSeek
const ai = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_API_BASE
});

// Initialize handlers and make them accessible to commands
client.voiceHandler = new VoiceHandler(client);
client.conversationHandler = new ConversationHandler(20, client.voiceHandler);

// Initialize commands collection
client.commands = new Collection();

// Load commands
loadCommands(client);

// Bot ready event
client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Bot is in ${client.guilds.cache.size} guilds`);
    
    // Restore voice state if any
    await restoreVoiceState(client);
});

// Handle cleanup on exit
process.on('SIGINT', async () => {
    console.log('Received SIGINT. Cleaning up...');
    await cleanup(client);
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM. Cleaning up...');
    await cleanup(client);
    process.exit(0);
});

process.on('message', async (msg) => {
    if (msg === 'cleanup') {
        console.log('Received cleanup message from nodemon');
        await cleanup(client);
        process.send('cleanup-done');
    }
});

// Generate AI response
async function generateResponse(id, newMessage, guildId = null) {
    console.log(`\n=== Generating response for ${id} ===`);
    
    // Get conversation history
    const history = client.conversationHandler.getHistory(id);
    
    // Keep system message plus last N messages
    const messages = [
        history[0], // System message
        ...history.slice(Math.max(1, history.length - client.conversationHandler.maxHistory + 1)),
        newMessage
    ];
    
    // Log the context window
    console.log('\n=== Chat Context Window ===');
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
        console.log('Received response:', responseText);

        // If in a voice channel and not currently speaking, speak the response
        if (guildId && client.voiceHandler.connections.has(guildId) && !client.voiceHandler.isSpeaking(guildId)) {
            await client.voiceHandler.speak(guildId, responseText);
        }

        return responseText;
    } catch (error) {
        console.error("Error generating response:", error);
        throw error;
    }
}

// Message event handler
client.on(Events.MessageCreate, async message => {
    // Ignore messages from bots
    if (message.author.bot) return;
    
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
    
    // Generate response if bot is mentioned or message is in DM
    if (message.mentions.has(client.user) || message.channel.type === 'DM') {
        await message.channel.sendTyping();
        
        try {
            const responseText = await generateResponse(message.channel.id, newMessage, message.guild?.id);
            
            // Add the user's message and bot's response to history after generating response
            client.conversationHandler.addMessage(message.channel.id, newMessage);
            client.conversationHandler.addMessage(
                message.channel.id,
                client.conversationHandler.formatAssistantMessage(responseText)
            );
            
            // Split and send response if too long
            const maxLength = 1900;
            for (let i = 0; i < responseText.length; i += maxLength) {
                const chunk = responseText.substring(i, i + maxLength);
                await message.channel.send(chunk);
            }
        } catch (error) {
            await message.reply(`Sorry <@${message.author.id}>, I encountered an error: ${error.message}`);
        }
    } else {
        // If not generating a response, just add the message to history
        client.conversationHandler.addMessage(message.channel.id, newMessage);
    }
});

// Start the bot
client.login(process.env.DISCORD_TOKEN); 