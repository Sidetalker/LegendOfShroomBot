module.exports = {
    name: 'clear',
    description: 'Clear the conversation history',
    async execute(message) {
        const conversationHandler = message.client.conversationHandler;
        conversationHandler.clearHistory(message.channel.id, message.guild?.id);
        await message.reply('🧹 Conversation history cleared!');
    }
}; 