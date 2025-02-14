module.exports = {
    name: 'rename',
    description: 'Change the bot\'s nickname (owner only)',
    async execute(message, args) {
        // Check if the command is used in a server
        if (!message.guild) {
            return message.reply('This command can only be used in a server.');
        }

        // Check if the user is the bot owner
        if (message.author.id !== process.env.OWNER_ID) {
            return message.reply('Only the bot owner can use this command.');
        }

        // Check if a new name was provided
        if (args.length === 0) {
            return message.reply('Please provide a new name. Usage: !rename new_name');
        }

        // Get the new name from args
        const newName = args.join(' ');

        try {
            // Change the bot's nickname
            await message.guild.members.me.setNickname(newName);
            await message.reply(`Successfully changed my nickname to "${newName}"`);
        } catch (error) {
            console.error('Error changing nickname:', error);
            await message.reply('Failed to change nickname. Make sure I have the necessary permissions.');
        }
    }
}; 