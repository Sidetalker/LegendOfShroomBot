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

        // Try different temp directories in case /tmp is not writable
        const possibleTempDirs = [
            path.join(os.tmpdir(), 'bot-voice-recognition'),
            '/tmp/bot-voice-recognition',
            path.join(process.cwd(), 'temp-voice-recognition')
        ];

        // Find a writable temp directory
        this.tempDir = null;
        for (const dir of possibleTempDirs) {
            try {
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
                }
                // Test if directory is writable
                const testFile = path.join(dir, '.write-test');
                fs.writeFileSync(testFile, 'test');
                fs.unlinkSync(testFile);
                this.tempDir = dir;
                console.log(`Using temp directory: ${dir}`);
                break;
            } catch (error) {
                console.log(`Failed to use temp directory ${dir}:`, error.message);
                continue;
            }
        }

        if (!this.tempDir) {
            throw new Error('Could not find or create a writable temporary directory');
        }

        // Keep track of active recordings
        this.activeRecordings = new Map();
        this.MIN_SAMPLES = 512;
    }

    startRecording(userId) {
        try {
            const filePath = path.join(this.tempDir, `${userId}-${Date.now()}.wav`);
            const writeStream = fs.createWriteStream(filePath, { mode: 0o644 });

            writeStream.on('error', (error) => {
                console.error(`Error in write stream for ${userId}:`, error);
                this.cleanup(userId);
            });

            // Write WAV header
            const header = Buffer.alloc(44);
            header.write('RIFF', 0);
            header.writeUInt32LE(0, 4);
            header.write('WAVE', 8);
            header.write('fmt ', 12);
            header.writeUInt32LE(16, 16);
            header.writeUInt16LE(1, 20);
            header.writeUInt16LE(1, 22);
            header.writeUInt32LE(16000, 24);
            header.writeUInt32LE(16000 * 2, 28);
            header.writeUInt16LE(2, 32);
            header.writeUInt16LE(16, 34);
            header.write('data', 36);
            header.writeUInt32LE(0, 40);

            writeStream.write(header);

            const decoder = new prism.opus.Decoder({
                frameSize: 960,
                channels: 1,
                rate: 16000
            });

            const inputStream = new Transform({
                transform(chunk, encoding, callback) {
                    callback(null, chunk);
                }
            });

            // Set up pipeline with error handling
            pipeline(inputStream, decoder, writeStream).catch(error => {
                console.error(`Pipeline error for user ${userId}:`, error);
                this.cleanup(userId);
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
        } catch (error) {
            console.error(`Error starting recording for user ${userId}:`, error);
            this.cleanup(userId);
        }
    }

    cleanup(userId) {
        const recording = this.activeRecordings.get(userId);
        if (recording) {
            try {
                if (recording.inputStream) {
                    recording.inputStream.destroy();
                }
                if (recording.decoder) {
                    recording.decoder.destroy();
                }
                if (recording.writeStream) {
                    recording.writeStream.destroy();
                }
                if (recording.filePath && fs.existsSync(recording.filePath)) {
                    fs.unlinkSync(recording.filePath);
                }
            } catch (error) {
                console.error(`Error during cleanup for user ${userId}:`, error);
            }
            this.activeRecordings.delete(userId);
        }
    }

    processAudioChunk(userId, chunk) {
        const recording = this.activeRecordings.get(userId);
        if (!recording) {
            return;
        }

        try {
            recording.bufferSize += chunk.length / 2;
            recording.inputStream.write(chunk);
        } catch (error) {
            console.error(`Error processing audio chunk for user ${userId}:`, error);
            this.cleanup(userId);
        }
    }

    async stopRecording(userId) {
        const recording = this.activeRecordings.get(userId);
        if (!recording) {
            return null;
        }

        try {
            recording.inputStream.end();
            await new Promise(resolve => recording.writeStream.on('finish', resolve));

            if (recording.bufferSize < this.MIN_SAMPLES) {
                console.log(`Not enough samples for processing (got ${recording.bufferSize}, need ${this.MIN_SAMPLES})`);
                this.cleanup(userId);
                return null;
            }

            if (!fs.existsSync(recording.filePath)) {
                console.error(`WAV file not found: ${recording.filePath}`);
                this.cleanup(userId);
                return null;
            }

            const stats = fs.statSync(recording.filePath);
            if (stats.size <= 44) {
                console.log('Audio file contains no audio data beyond WAV header');
                this.cleanup(userId);
                return null;
            }

            // Update WAV header
            try {
                const fd = fs.openSync(recording.filePath, 'r+');
                const fileSize = Buffer.alloc(4);
                fileSize.writeUInt32LE(stats.size - 8, 0);
                fs.writeSync(fd, fileSize, 0, 4, 4);
                const dataSize = Buffer.alloc(4);
                dataSize.writeUInt32LE(stats.size - 44, 0);
                fs.writeSync(fd, dataSize, 0, 4, 40);
                fs.closeSync(fd);
            } catch (error) {
                console.error(`Error updating WAV header for user ${userId}:`, error);
                this.cleanup(userId);
                return null;
            }

            try {
                const result = await this.leopard.processFile(recording.filePath);
                this.cleanup(userId);

                if (!result?.transcript || !result.words || result.words.length === 0) {
                    console.log('No valid speech detected, ignoring result.');
                    return null;
                }

                const transcript = result.transcript.toLowerCase();
                const averageConfidence = result.words.reduce((sum, word) => sum + word.confidence, 0) / result.words.length;

                console.log(`Speech recognition result for user ${userId}: "${transcript}"`);
                console.log(`Average confidence score: ${averageConfidence}`);

                if (averageConfidence < 0.6) {
                    console.log('Confidence too low, ignoring result.');
                    return null;
                }

                if (transcript.includes('shroom') || transcript.includes('mushroom') || transcript.includes('bot')) {
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
            return null;
        } finally {
            this.cleanup(userId);
        }
    }

    createTransformStream(userId) {
        this.startRecording(userId);
        return new Transform({
            transform: (chunk, encoding, callback) => {
                this.processAudioChunk(userId, chunk);
                callback(null, chunk);
            },
            destroy: (error, callback) => {
                this.cleanup(userId);
                callback(error);
            }
        });
    }
}

module.exports = SpeechRecognizer; 