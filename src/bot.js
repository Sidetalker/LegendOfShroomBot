const { Client, GatewayIntentBits, Events, Collection } = require('discord.js');
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
        GatewayIntentBits.DirectMessages
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

// Generate AI response for text chat
async function generateTextResponse(channelId, newMessage) {
    console.log(`\n=== Generating text response for channel ${channelId} ===`);
    
    // Get text conversation history
    const history = client.conversationHandler.getTextHistory(channelId);
    
    // Keep system message plus last N messages
    const messages = [
        history[0], // System message
        ...history.slice(Math.max(1, history.length - client.conversationHandler.maxHistory + 1)),
        newMessage
    ];
    
    // Log the context window
    console.log('\n=== Text Chat Context Window ===');
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
            // Add the user's message to text history first
            client.conversationHandler.addTextMessage(message.channel.id, newMessage);
            
            // Generate and get the response
            const responseText = await generateTextResponse(message.channel.id, newMessage);
            
            // Add bot's response to text history
            client.conversationHandler.addTextMessage(
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
        // If not generating a response, just add the message to text history
        client.conversationHandler.addTextMessage(message.channel.id, newMessage);
    }
});

// Set up cleanup handlers
cleanup(client);

// Log in to Discord
client.login(process.env.DISCORD_TOKEN); 