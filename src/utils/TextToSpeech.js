const { Readable } = require('stream');

class TextToSpeech {
    constructor(config = {}) {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            throw new Error('ELEVENLABS_API_KEY is required in environment variables');
        }

        // Default configuration
        this.config = {
            voiceId: 'pNInz6obpgDQGcFmaJgB',  // Adam, a deep male voice
            model: 'eleven_monolingual_v1',
            stability: 0.5,
            similarityBoost: 0.75,
            ...config
        };

        this.apiKey = apiKey;
        this.apiUrl = 'https://api.elevenlabs.io/v1/text-to-speech';
    }

    async textToSpeech(text) {
        try {
            console.log('Requesting TTS from Elevenlabs...');
            const response = await fetch(`${this.apiUrl}/${this.config.voiceId}`, {
                method: 'POST',
                headers: {
                    'Accept': 'audio/mpeg',
                    'Content-Type': 'application/json',
                    'xi-api-key': this.apiKey
                },
                body: JSON.stringify({
                    text,
                    model_id: this.config.model,
                    voice_settings: {
                        stability: this.config.stability,
                        similarity_boost: this.config.similarityBoost
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Elevenlabs API error: ${response.status} - ${errorText}`);
            }

            const buffer = await response.arrayBuffer();
            const stream = new Readable();
            stream.push(Buffer.from(buffer));
            stream.push(null);
            
            return stream;
        } catch (error) {
            console.error('Error in TextToSpeech:', error);
            throw error;
        }
    }

    // Available premium voices (there are more, these are some good male options):
    // Adam: 'pNInz6obpgDQGcFmaJgB' (deep, authoritative)
    // Antoni: 'ErXwobaYiN019PkySvjV' (warm, friendly)
    // Josh: 'TxGEqnHWrfWFTfGW9XjX' (deep, calm)
    // Sam: 'yoZ06aMxZJJ28mfd3POQ' (authoritative, professional)
    // Fin: 'jsCqWAovK2LkecY7zXl4' (young, energetic)

    setVoice(voiceId) {
        this.config.voiceId = voiceId;
    }

    setStability(stability) {
        this.config.stability = Math.max(0, Math.min(1, stability));
    }

    setSimilarityBoost(boost) {
        this.config.similarityBoost = Math.max(0, Math.min(1, boost));
    }
}

module.exports = { TextToSpeech }; 