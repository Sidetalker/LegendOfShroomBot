const { Leopard } = require("@picovoice/leopard-node");
const { Transform } = require('stream');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const os = require('os');
const prism = require('prism-media');
const { pipeline } = require('stream/promises');

class SpeechRecognizer extends EventEmitter {
    constructor() {
        super();
        // Initialize Leopard
        const accessKey = process.env.PICOVOICE_ACCESS_KEY;
        if (!accessKey) {
            throw new Error('PICOVOICE_ACCESS_KEY is required in environment variables');
        }

        // Create Leopard instance
        this.leopard = new Leopard(accessKey);

        this.tempDir = path.join(os.tmpdir(), 'bot-voice-recognition');
        
        // Create temp directory if it doesn't exist
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }

        // Keep track of active recordings
        this.activeRecordings = new Map(); // userId -> { writeStream, filePath, decoder, inputStream, bufferSize }
        
        // Minimum number of samples required by Leopard
        this.MIN_SAMPLES = 512;
    }

    startRecording(userId) {
        const filePath = path.join(this.tempDir, `${userId}-${Date.now()}.wav`);
        const writeStream = fs.createWriteStream(filePath);

        // Write WAV header
        const header = Buffer.alloc(44);
        header.write('RIFF', 0);
        header.writeUInt32LE(0, 4); // File size (to be updated later)
        header.write('WAVE', 8);
        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16); // Format chunk size
        header.writeUInt16LE(1, 20); // Audio format (PCM)
        header.writeUInt16LE(1, 22); // Number of channels (mono)
        header.writeUInt32LE(16000, 24); // Sample rate (16kHz)
        header.writeUInt32LE(16000 * 2, 28); // Byte rate (SampleRate * NumChannels * BitsPerSample/8)
        header.writeUInt16LE(2, 32); // Block align (NumChannels * BitsPerSample/8)
        header.writeUInt16LE(16, 34); // Bits per sample (16 bits)
        header.write('data', 36);
        header.writeUInt32LE(0, 40); // Data size (to be updated later)

        writeStream.write(header);

        // Create Opus decoder with larger frame size
        const decoder = new prism.opus.Decoder({
            frameSize: 960,
            channels: 1,
            rate: 16000
        });

        // Create input stream for audio chunks with buffering
        const inputStream = new Transform({
            transform(chunk, encoding, callback) {
                callback(null, chunk);
            }
        });

        // Set up pipeline: inputStream -> decoder -> writeStream
        pipeline(inputStream, decoder, writeStream).catch(error => {
            console.error(`Pipeline error for user ${userId}:`, error);
        });

        this.activeRecordings.set(userId, {
            writeStream,
            filePath,
            decoder,
            inputStream,
            startTime: Date.now(),
            bufferSize: 0
        });

        console.log(`Started recording for user ${userId}`);
    }

    processAudioChunk(userId, chunk) {
        const recording = this.activeRecordings.get(userId);
        if (!recording) {
            console.log(`No active recording for user ${userId}`);
            return;
        }

        try {
            recording.bufferSize += chunk.length / 2; // Divide by 2 because we're using 16-bit samples
            recording.inputStream.write(chunk);
        } catch (error) {
            console.error(`Error processing audio chunk for user ${userId}:`, error);
        }
    }

    async stopRecording(userId) {
        const recording = this.activeRecordings.get(userId);
        if (!recording) {
            console.log(`No active recording found for user ${userId}`);
            return null;
        }

        try {
            // End all streams
            recording.inputStream.end();
            await new Promise(resolve => recording.writeStream.on('finish', resolve));

            // Check if we have enough samples
            if (recording.bufferSize < this.MIN_SAMPLES) {
                console.log(`Not enough samples for processing (got ${recording.bufferSize}, need ${this.MIN_SAMPLES})`);
                fs.unlinkSync(recording.filePath);
                this.activeRecordings.delete(userId);
                return null;
            }

            // Update WAV header with final file size
            const stats = fs.statSync(recording.filePath);
            const fd = fs.openSync(recording.filePath, 'r+');
            const fileSize = Buffer.alloc(4);
            fileSize.writeUInt32LE(stats.size - 8, 0);
            fs.writeSync(fd, fileSize, 0, 4, 4);
            const dataSize = Buffer.alloc(4);
            dataSize.writeUInt32LE(stats.size - 44, 0);
            fs.writeSync(fd, dataSize, 0, 4, 40);
            fs.closeSync(fd);

            // Process the audio file
            console.log(`Processing audio file for user ${userId}`);
            console.log(`Audio file size: ${stats.size} bytes`);
            console.log(`Total samples: ${recording.bufferSize}`);
            
            if (stats.size <= 44) { // 44 is the WAV header size
                console.log('Audio file contains no audio data beyond WAV header');
                return null;
            }

            try {
                const result = await this.leopard.processFile(recording.filePath);
                
                // Clean up the file early since we don't need it anymore
                fs.unlinkSync(recording.filePath);
                this.activeRecordings.delete(userId);

                // Ignore empty results or results with no words/confidence scores
                if (!result?.transcript || !result.words || result.words.length === 0) {
                    console.log('No valid speech detected, ignoring result.');
                    return null;
                }

                const transcript = result.transcript.toLowerCase();
                const averageConfidence = result.words.reduce((sum, word) => sum + word.confidence, 0) / result.words.length;
                
                console.log(`Speech recognition result for user ${userId}: "${transcript}"`);
                console.log(`Average confidence score: ${averageConfidence}`);
                console.log(`Individual word confidence scores: ${result.words.map(w => w.confidence).join(', ')}`);

                // Only process results with decent confidence
                if (averageConfidence < 0.6) {
                    console.log('Confidence too low, ignoring result.');
                    return null;
                }

                // Check for bot keyword trigger
                if (transcript.includes('shroom') || transcript.includes('mushroom') || transcript.includes('bot')) {
                    // Emit an event for the bot to handle
                    this.emit('botTrigger', {
                        userId,
                        text: transcript,
                        confidence: averageConfidence
                    });
                }

                return transcript;
            } catch (error) {
                console.error('Leopard processing error:', error);
                return null;
            }
        } catch (error) {
            console.error(`Error processing recording for user ${userId}:`, error);
            // Clean up on error
            if (recording.filePath && fs.existsSync(recording.filePath)) {
                fs.unlinkSync(recording.filePath);
            }
            this.activeRecordings.delete(userId);
            return null;
        }
    }

    // Create a transform stream for real-time audio processing
    createTransformStream(userId) {
        this.startRecording(userId);
        return new Transform({
            transform: (chunk, encoding, callback) => {
                this.processAudioChunk(userId, chunk);
                callback(null, chunk);
            }
        });
    }
}

module.exports = SpeechRecognizer; 