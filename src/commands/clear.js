module.exports = {
    name: 'clear',
    description: 'Clear the conversation history',
    async execute(message) {
        const conversationHandler = message.client.conversationHandler;
        const isDM = message.channel.type === 1;

        if (isDM) {
            conversationHandler.clearDMHistory(message.author.id);
        } else {
            conversationHandler.clearTextHistory(message.channel.id, message.guild?.id);
        }
        
        await message.reply('🧹 Conversation history cleared!');
    }
}; 