module.exports = {
    name: 'leave',
    description: 'Leave the voice channel',
    async execute(message) {
        const voiceHandler = message.client.voiceHandler;
        await voiceHandler.leaveVoiceChannel(message.guild.id);
        await message.reply('👋 See ya!');
    }
}; 