const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '.voice-state.json');

// Save the current voice state
function saveVoiceState(client) {
    const voiceStates = [];
    
    // Get all voice connections
    if (client.voiceHandler) {
        client.voiceHandler.connections.forEach((connection, guildId) => {
            voiceStates.push({
                guildId,
                channelId: connection.joinConfig.channelId
            });
        });
    }

    // Save to file
    fs.writeFileSync(STATE_FILE, JSON.stringify(voiceStates));
    console.log('Voice state saved:', voiceStates);
}

// Restore the voice state
async function restoreVoiceState(client) {
    if (!fs.existsSync(STATE_FILE)) {
        console.log('No voice state to restore');
        return;
    }

    try {
        const voiceStates = JSON.parse(fs.readFileSync(STATE_FILE));
        console.log('Restoring voice state:', voiceStates);

        for (const state of voiceStates) {
            const guild = client.guilds.cache.get(state.guildId);
            if (!guild) continue;

            const channel = guild.channels.cache.get(state.channelId);
            if (!channel) continue;

            console.log(`Rejoining channel ${channel.name} in ${guild.name}`);
            await client.voiceHandler.joinVoiceChannel(channel);
        }

        // Clean up the state file
        fs.unlinkSync(STATE_FILE);
    } catch (error) {
        console.error('Error restoring voice state:', error);
    }
}

// Clean up function for graceful shutdown
async function cleanup(client) {
    console.log('Cleaning up before restart...');
    
    if (client.voiceHandler) {
        // Save current voice state
        saveVoiceState(client);

        // Leave all voice channels
        const leavePromises = [];
        client.voiceHandler.connections.forEach((_, guildId) => {
            leavePromises.push(client.voiceHandler.leaveVoiceChannel(guildId));
        });
        
        await Promise.all(leavePromises);
    }
    
    console.log('Cleanup complete');
}

module.exports = { cleanup, restoreVoiceState }; 