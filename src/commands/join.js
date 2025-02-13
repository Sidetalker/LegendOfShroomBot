module.exports = {
    name: 'join',
    description: 'Join the user\'s voice channel',
    async execute(message) {
        if (!message.member.voice.channel) {
            await message.reply('You need to be in a voice channel for me to join!');
            return;
        }

        const voiceHandler = message.client.voiceHandler;
        if (await voiceHandler.joinVoiceChannel(message.member.voice.channel)) {
            await message.reply('👋 I\'ve joined your voice channel!');
        } else {
            await message.reply('❌ I couldn\'t join the voice channel!');
        }
    }
}; 