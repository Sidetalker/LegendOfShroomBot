module.exports = {
    name: 'dm',
    description: 'Owner only - Make the bot DM a user',
    async execute(message, args) {
        // Check if the command is from the owner (your user ID)
        if (message.author.id !== '396009080042422314') {  // Replace with your Discord user ID
            return message.reply('Nice try, but only my creator can make me DM people.');
        }

        // Check if we have enough arguments
        if (args.length < 2) {
            return message.reply('Usage: !dm <user_id> <message>');
        }

        const targetUserId = args[0];
        const promptMessage = args.slice(1).join(' ');

        try {
            // Get the target user
            const targetUser = await message.client.users.fetch(targetUserId);
            if (!targetUser) {
                return message.reply('Could not find a user with that ID.');
            }

            // Create a fake message event that looks like it came from the target user
            const fakeMessage = {
                author: targetUser,
                content: promptMessage,
                channel: await targetUser.createDM(),
                guild: null,
                reply: async (content) => targetUser.send(content),
                mentions: { has: () => false }
            };

            // Process the message as if it was a DM from the target user
            const isDM = true;
            const conversationHandler = message.client.conversationHandler;
            
            // Format and add the user's message to DM history
            const userMessage = conversationHandler.formatUserMessage(targetUser.id, promptMessage);
            conversationHandler.addDMMessage(targetUser.id, userMessage);

            // Generate the response
            const responseText = await message.client.generateTextResponse(
                fakeMessage.channel.id,
                userMessage,
                isDM,
                targetUser.id
            );

            // Add bot's response to DM history
            const assistantMessage = conversationHandler.formatAssistantMessage(responseText);
            conversationHandler.addDMMessage(targetUser.id, assistantMessage);

            // Send the response to the user
            await targetUser.send(responseText);

            // Confirm to the owner that the message was sent
            await message.reply(`Message sent to ${targetUser.tag} and they should receive my response shortly.`);

        } catch (error) {
            console.error('Error in DM command:', error);
            await message.reply(`Failed to send DM: ${error.message}`);
        }
    },
}; 