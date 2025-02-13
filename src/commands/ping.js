module.exports = {
    name: 'ping',
    description: 'Check bot latency',
    async execute(message) {
        const latency = Math.round(message.client.ws.ping);
        await message.reply(`Pong! Latency: ${latency}ms`);
    }
}; 