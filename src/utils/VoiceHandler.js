const { 
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    VoiceReceiver,
    EndBehaviorType
} = require('@discordjs/voice');
const googleTTS = require('google-tts-api');
const { Readable } = require('stream');
const { EventEmitter } = require('events');
const https = require('https');
const SpeechRecognizer = require('./SpeechRecognizer');

class VoiceHandler extends EventEmitter {
    constructor(client) {
        super();
        this.client = client;
        this.connections = new Map(); // guild_id -> connection
        this.players = new Map(); // guild_id -> player
        this.speaking = new Map(); // guild_id -> boolean
        this.receivers = new Map(); // guild_id -> receiver
        this.speakingUsers = new Map(); // guild_id -> Set of user IDs
        this.speechRecognizer = new SpeechRecognizer();
        
        // Forward botTrigger events from SpeechRecognizer
        this.speechRecognizer.on('botTrigger', (data) => {
            console.log('VoiceHandler received botTrigger event:', data);
            this.emit('botTrigger', data);
        });
        
        // Set up voice state update handler
        this.client.on('voiceStateUpdate', (oldState, newState) => {
            this._handleVoiceStateUpdate(oldState, newState);
        });
    }

    async joinVoiceChannel(channel) {
        try {
            console.log(`Attempting to join voice channel ${channel.name} in guild ${channel.guild.name}`);

            // Check if already in this channel
            if (this.connections.has(channel.guild.id)) {
                console.log('Already in this voice channel');
                return true;
            }

            // Create connection
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });

            // Create audio player
            const player = createAudioPlayer();
            connection.subscribe(player);

            // Set up connection error handling
            connection.on('error', error => {
                console.error(`Error in voice connection: ${error}`);
            });

            // Set up player error handling
            player.on('error', error => {
                console.error(`Error in audio player: ${error}`);
            });

            // Wait for the connection to be ready
            try {
                await entersState(connection, VoiceConnectionStatus.Ready, 20e3);
                console.log('Connection is ready!');
            } catch (error) {
                console.error('Failed to connect within 20 seconds:', error);
                connection.destroy();
                throw error;
            }

            // Initialize voice receiver
            const receiver = connection.receiver;
            this.receivers.set(channel.guild.id, receiver);
            this.speakingUsers.set(channel.guild.id, new Set());

            // Set up speaking event handlers
            this._setupVoiceReceiver(channel.guild.id, receiver);

            // Store connection and player
            this.connections.set(channel.guild.id, connection);
            this.players.set(channel.guild.id, player);
            this.speaking.set(channel.guild.id, false);

            console.log(`Successfully joined voice channel ${channel.name}`);
            return true;
        } catch (error) {
            console.error('Error joining voice channel:', error);
            return false;
        }
    }

    _setupVoiceReceiver(guildId, receiver) {
        console.log(`Setting up voice receiver for guild ${guildId}`);

        // Listen for speaking start/stop events
        receiver.speaking.on('start', (userId) => {
            const speakingSet = this.speakingUsers.get(guildId);
            if (speakingSet) {
                speakingSet.add(userId);
                this._handleUserSpeaking(guildId, userId, true);
            }
        });

        receiver.speaking.on('end', (userId) => {
            const speakingSet = this.speakingUsers.get(guildId);
            if (speakingSet) {
                speakingSet.delete(userId);
                this._handleUserSpeaking(guildId, userId, false);
            }
        });

        // Log the current receiver state
        console.log(`Voice receiver setup complete for guild ${guildId}`);
        console.log('Receiver state:', {
            subscriptions: receiver.subscriptions.size,
            speaking: this.speakingUsers.get(guildId)?.size || 0
        });
    }

    _handleUserSpeaking(guildId, userId, isSpeaking) {
        const user = this.client.users.cache.get(userId);
        if (!user) {
            console.log(`Unknown user ${userId} ${isSpeaking ? 'started' : 'stopped'} speaking`);
            return;
        }

        console.log(`${user.tag} ${isSpeaking ? 'started' : 'stopped'} speaking in guild ${guildId}`);
        
        if (isSpeaking) {
            // Create an audio stream for this user
            const receiver = this.receivers.get(guildId);
            if (!receiver) {
                console.error('No receiver found for guild', guildId);
                return;
            }

            console.log(`Creating audio stream for user ${user.tag}`);
            const audioStream = receiver.subscribe(userId, {
                end: {
                    behavior: EndBehaviorType.AfterSilence,
                    duration: 100
                }
            });

            // Create transform stream for speech recognition
            const recognizerStream = this.speechRecognizer.createTransformStream(userId);

            // Track stream state
            let streamEnded = false;
            let streamError = null;

            // Track total bytes received
            let totalBytes = 0;

            audioStream.on('data', (chunk) => {
                if (!streamEnded && !streamError) {
                    totalBytes += chunk.length;
                    try {
                        recognizerStream.write(chunk);
                    } catch (error) {
                        console.error(`Error writing to recognizer stream for ${user.tag}:`, error);
                        streamError = error;
                    }
                }
            });

            audioStream.on('end', async () => {
                streamEnded = true;
                console.log(`Total audio data received from ${user.tag}: ${totalBytes} bytes`);
                console.log(`Audio stream ended for ${user.tag}`);
                
                try {
                    recognizerStream.end();
                    // Get speech recognition result
                    const text = await this.speechRecognizer.stopRecording(userId);
                    if (text && text.trim()) {
                        console.log(`Transcribed text from ${user.tag}: "${text}"`);
                    }
                } catch (error) {
                    console.error(`Error stopping recording for ${user.tag}:`, error);
                }
            });

            audioStream.on('error', (error) => {
                streamError = error;
                console.error(`Error in audio stream for ${user.tag}:`, error);
                try {
                    recognizerStream.end();
                    this.speechRecognizer.stopRecording(userId).catch(err => {
                        console.error(`Error stopping recording after stream error for ${user.tag}:`, err);
                    });
                } catch (err) {
                    console.error(`Error cleaning up after stream error for ${user.tag}:`, err);
                }
            });

            recognizerStream.on('error', (error) => {
                console.error(`Error in recognizer stream for ${user.tag}:`, error);
            });
        }
    }

    _handleVoiceStateUpdate(oldState, newState) {
        const guildId = newState.guild.id;
        const userId = newState.member.user.id;

        console.log(`Voice state update in guild ${guildId} for user ${userId}`);
        console.log('Old state:', {
            channelId: oldState.channelId,
            serverDeaf: oldState.serverDeaf,
            serverMute: oldState.serverMute,
            selfDeaf: oldState.selfDeaf,
            selfMute: oldState.selfMute
        });
        console.log('New state:', {
            channelId: newState.channelId,
            serverDeaf: newState.serverDeaf,
            serverMute: newState.serverMute,
            selfDeaf: newState.selfDeaf,
            selfMute: newState.selfMute
        });
    }

    async leaveVoiceChannel(guildId) {
        console.log(`Attempting to leave voice channel in guild ${guildId}`);
        
        const connection = this.connections.get(guildId);
        if (connection) {
            // Clean up voice receiver
            const receiver = this.receivers.get(guildId);
            if (receiver) {
                console.log('Cleaning up voice receiver');
                receiver.speaking.removeAllListeners();
                this.receivers.delete(guildId);
            }

            // Clean up speaking users set
            this.speakingUsers.delete(guildId);

            connection.destroy();
            this.connections.delete(guildId);
            this.players.delete(guildId);
            this.speaking.delete(guildId);
            console.log('Successfully left voice channel');
        }
    }

    async speak(guildId, text) {
        console.log(`Attempting to speak in guild ${guildId}: ${text.substring(0, 50)}...`);

        const connection = this.connections.get(guildId);
        const player = this.players.get(guildId);

        if (!connection || !player) {
            console.error('Not in a voice channel for this guild');
            return;
        }

        try {
            // Set speaking flag
            this.speaking.set(guildId, true);

            // Get the audio URL from Google TTS
            const audioURL = googleTTS.getAudioUrl(text, {
                lang: 'en',
                slow: false,
                host: 'https://translate.google.com',
            });

            // Create a promise to handle the audio download and playback
            const playAudio = new Promise((resolve, reject) => {
                https.get(audioURL, response => {
                    if (response.statusCode !== 200) {
                        reject(new Error(`Failed to get audio: ${response.statusCode}`));
                        return;
                    }

                    const chunks = [];
                    response.on('data', chunk => chunks.push(chunk));
                    response.on('end', () => {
                        const audioBuffer = Buffer.concat(chunks);
                        const audioStream = Readable.from(audioBuffer);
                        const audioResource = createAudioResource(audioStream);

                        player.play(audioResource);

                        player.once(AudioPlayerStatus.Playing, () => {
                            console.log('Started playing audio');
                        });

                        player.once(AudioPlayerStatus.Idle, () => {
                            console.log('Finished playing audio');
                            this.speaking.set(guildId, false);
                            resolve();
                        });
                    });
                }).on('error', error => {
                    console.error('Error getting audio:', error);
                    this.speaking.set(guildId, false);
                    reject(error);
                });
            });

            await playAudio;
        } catch (error) {
            console.error('Error in speak function:', error);
            this.speaking.set(guildId, false);
        }
    }

    async playAudio(audioStream) {
        try {
            // Get the first guild ID (assuming bot is only in one voice channel at a time)
            const guildId = Array.from(this.connections.keys())[0];
            if (!guildId) {
                console.error('Not connected to any voice channels');
                return;
            }

            const connection = this.connections.get(guildId);
            const player = this.players.get(guildId);

            if (!connection || !player) {
                console.error('No voice connection or player found');
                return;
            }

            console.log('Creating audio resource from stream');
            const resource = createAudioResource(audioStream);
            
            // Play the audio
            player.play(resource);

            // Wait for the audio to finish playing
            return new Promise((resolve, reject) => {
                player.once(AudioPlayerStatus.Idle, () => {
                    console.log('Finished playing audio');
                    resolve();
                });

                player.once('error', (error) => {
                    console.error('Error playing audio:', error);
                    reject(error);
                });
            });
        } catch (error) {
            console.error('Error in playAudio:', error);
            throw error;
        }
    }

    isSpeaking(guildId) {
        return this.speaking.get(guildId) || false;
    }
}

module.exports = VoiceHandler; 