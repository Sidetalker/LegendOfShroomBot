import asyncio
import speech_recognition as sr
from gtts import gTTS
import discord
import io
import sounddevice as sd
import numpy as np
from vosk import Model, KaldiRecognizer
import json
import wave
import tempfile
import os
from typing import Optional, Callable, Dict
import logging
import traceback
import sys
import time
import ctypes.util

# Set up logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('VoiceHandler')

def _load_opus():
    """Load the Opus library for voice support"""
    try:
        if discord.opus.is_loaded():
            logger.info("Opus already loaded")
            return True

        # Check system architecture
        is_arm = 'arm' in os.uname().machine.lower()
        logger.info(f"System architecture: {os.uname().machine}")
        
        # Prioritize paths based on architecture
        if is_arm:
            possible_paths = [
                # ARM64 paths first
                '/opt/homebrew/opt/opus/lib/libopus.dylib',
                '/opt/homebrew/lib/libopus.dylib',
                '/opt/homebrew/lib/libopus.0.dylib',
                '/opt/homebrew/Cellar/opus/1.5.2/lib/libopus.dylib',
                # Fallback to other paths
                '/usr/lib/libopus.dylib',
                '/usr/local/opt/opus/lib/libopus.dylib',
                '/usr/local/lib/libopus.dylib',
                '/usr/local/lib/libopus.0.dylib'
            ]
        else:
            possible_paths = [
                # x86_64 paths first
                '/usr/local/opt/opus/lib/libopus.dylib',
                '/usr/local/lib/libopus.dylib',
                '/usr/local/lib/libopus.0.dylib',
                '/usr/local/Cellar/opus/1.5.2/lib/libopus.dylib',
                # Fallback to other paths
                '/usr/lib/libopus.dylib',
                '/opt/homebrew/opt/opus/lib/libopus.dylib',
                '/opt/homebrew/lib/libopus.dylib',
                '/opt/homebrew/lib/libopus.0.dylib'
            ]
            
        # Try each path
        for path in possible_paths:
            if os.path.exists(path):
                try:
                    logger.info(f"Found opus at: {path}")
                    logger.info(f"Attempting to load opus from: {path}")
                    discord.opus.load_opus(path)
                    if discord.opus.is_loaded():
                        logger.info(f"Successfully loaded opus from {path}")
                        return True
                except Exception as e:
                    logger.debug(f"Failed to load {path}: {e}")
                    continue
        
        # If no paths worked, try find_library as last resort
        opus_name = ctypes.util.find_library('opus')
        if opus_name:
            try:
                logger.info(f"Attempting to load opus from find_library result: {opus_name}")
                discord.opus.load_opus(opus_name)
                if discord.opus.is_loaded():
                    logger.info("Successfully loaded opus library")
                    return True
            except Exception as e:
                logger.debug(f"Failed to load {opus_name}: {e}")
        
        logger.error("Could not find a compatible opus library")
        return False
        
    except Exception as e:
        logger.error(f"Error loading opus: {e}")
        logger.error(f"Stack trace: {traceback.format_exc()}")
        return False

class VoiceHandler:
    def __init__(self, bot):
        logger.info("Initializing VoiceHandler")
        self.bot = bot
        self.voice_clients: Dict[int, discord.VoiceClient] = {}  # guild_id -> voice_client
        self.recognizers: Dict[int, KaldiRecognizer] = {}  # guild_id -> recognizer
        self.is_listening: Dict[int, bool] = {}  # guild_id -> listening_status
        self.callback: Optional[Callable] = None
        self.streams: Dict[int, sd.InputStream] = {}  # guild_id -> audio stream
        self.speaking_users: Dict[int, discord.Member] = {}  # guild_id -> current speaking user
        self.is_speaking: Dict[int, bool] = {}  # guild_id -> bot speaking status
        
        # Set up voice state update event
        @bot.event
        async def on_voice_state_update(member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
            guild_id = member.guild.id
            if guild_id in self.voice_clients:
                # Check if the user started or stopped speaking
                if before.self_deaf == after.self_deaf and before.self_mute == after.self_mute:
                    if after.self_stream:  # User is speaking
                        logger.debug(f"User {member.name} started speaking")
                        self.speaking_users[guild_id] = member
                    else:  # User stopped speaking
                        logger.debug(f"User {member.name} stopped speaking")
                        if guild_id in self.speaking_users and self.speaking_users[guild_id] == member:
                            self.speaking_users[guild_id] = None
        
        # Load Opus
        if not _load_opus():
            logger.error("Failed to load Opus codec. Voice functionality may not work.")
        
        # Initialize Vosk model
        model_path = "model"
        if not os.path.exists(model_path):
            logger.error(f"Model directory not found at {model_path}")
            raise RuntimeError("Please download the Vosk model and place it in a 'model' directory")
        
        # Check model directory contents
        model_files = os.listdir(model_path)
        logger.info(f"Model directory contents: {model_files}")
        
        required_files = ['final.mdl', 'conf', 'ivector', 'graph']
        missing_files = [f for f in required_files if f not in model_files]
        if missing_files:
            logger.error(f"Missing required model files: {missing_files}")
            raise RuntimeError(f"Model directory is missing required files: {missing_files}")

        logger.info(f"Loading Vosk model from {model_path}")
        try:
            self.model = Model(model_path)
            logger.info("Vosk model loaded successfully")
            
            # Test recognizer creation with explicit settings
            logger.info("Creating test recognizer with sample rate 16000")
            test_recognizer = KaldiRecognizer(self.model, 16000)
            test_recognizer.SetWords(True)  # Enable word timing
            test_recognizer.SetPartialWords(True)  # Enable partial results
            logger.info("Successfully tested recognizer creation")
            del test_recognizer
        except Exception as e:
            logger.error(f"Failed to load Vosk model: {str(e)}")
            logger.error(f"Stack trace: {traceback.format_exc()}")
            # Check model configuration
            conf_path = os.path.join(model_path, 'conf')
            if os.path.exists(conf_path):
                try:
                    conf_files = os.listdir(conf_path)
                    logger.info(f"Model conf directory contents: {conf_files}")
                    mfcc_conf_path = os.path.join(conf_path, 'mfcc.conf')
                    if os.path.exists(mfcc_conf_path):
                        with open(mfcc_conf_path, 'r') as f:
                            logger.info(f"MFCC configuration:\n{f.read()}")
                except Exception as conf_e:
                    logger.error(f"Error reading model configuration: {str(conf_e)}")
            raise
        
    async def join_voice_channel(self, voice_channel: discord.VoiceChannel) -> bool:
        """Join a voice channel and set up audio recognition"""
        logger.info(f"Attempting to join voice channel {voice_channel.name} in guild {voice_channel.guild.name}")
        
        if voice_channel.guild.id in self.voice_clients:
            logger.info("Already in this voice channel")
            return True
            
        try:
            # Ensure Opus is loaded before connecting
            if not _load_opus():
                logger.error("Failed to load Opus codec. Cannot join voice channel.")
                return False

            voice_client = await voice_channel.connect()
            self.voice_clients[voice_channel.guild.id] = voice_client
            
            # Set up speaking event handler
            def on_speaking_update(user: discord.User, speaking: bool):
                guild_id = voice_channel.guild.id
                member = voice_channel.guild.get_member(user.id)
                if member:
                    if speaking:
                        logger.debug(f"User {member.name} started speaking")
                        self.speaking_users[guild_id] = member
                    else:
                        logger.debug(f"User {member.name} stopped speaking")
                        if guild_id in self.speaking_users and self.speaking_users[guild_id].id == member.id:
                            self.speaking_users[guild_id] = None

            voice_client.on_speaking = on_speaking_update
            
            # Initialize recognizer with proper settings
            try:
                recognizer = KaldiRecognizer(self.model, 16000)
                recognizer.SetWords(True)  # Enable word timing
                recognizer.SetPartialWords(True)  # Enable partial results
                self.recognizers[voice_channel.guild.id] = recognizer
                logger.info("Successfully created recognizer for voice channel")
            except Exception as e:
                logger.error(f"Failed to create recognizer: {e}")
                logger.error(f"Stack trace: {traceback.format_exc()}")
                await voice_client.disconnect()
                return False
            
            self.is_listening[voice_channel.guild.id] = False
            logger.info(f"Successfully joined voice channel {voice_channel.name}")
            return True
        except Exception as e:
            logger.error(f"Error joining voice channel: {e}")
            return False
            
    async def leave_voice_channel(self, guild_id: int) -> None:
        """Leave the voice channel in the specified guild"""
        logger.info(f"Attempting to leave voice channel in guild {guild_id}")
        if guild_id in self.voice_clients:
            await self.voice_clients[guild_id].disconnect()
            del self.voice_clients[guild_id]
            del self.recognizers[guild_id]
            self.is_listening[guild_id] = False
            logger.info("Successfully left voice channel")
            
    async def start_listening(self, guild_id: int, callback: Callable) -> None:
        """Start listening for audio in the specified guild"""
        logger.info(f"Starting to listen in guild {guild_id}")
        
        if guild_id not in self.voice_clients:
            logger.error("Not in a voice channel for this guild")
            return
            
        if self.is_listening[guild_id]:
            logger.info("Already listening in this guild")
            return
            
        logger.debug(f"Current callback state - Type: {type(callback)}, ID: {id(callback)}")
        self.callback = callback
        self.is_listening[guild_id] = True
        self.is_speaking[guild_id] = False  # Initialize speaking flag
        
        voice_client = self.voice_clients[guild_id]
        recognizer = self.recognizers[guild_id]
        
        try:
            # Start audio stream with correct settings for Vosk
            logger.info("Starting audio input stream")
            stream = sd.InputStream(
                channels=1,
                samplerate=16000,
                callback=self.audio_callback,  # Use the class method
                dtype=np.float32,  # Use float32 for better audio quality
                blocksize=8000,  # Process in smaller chunks
                device=None,  # Use default input device
                latency='low'  # Use low latency for better real-time processing
            )
            
            # Store the stream reference
            self.streams[guild_id] = stream
            
            stream.start()
            logger.info("Audio stream started successfully")
            
        except Exception as e:
            logger.error(f"Error starting audio stream: {e}")
            logger.error(f"Stack trace: {traceback.format_exc()}")
            
    def audio_callback(self, indata, frames, time, status):
        """Callback for processing audio data"""
        try:
            if status:
                logger.warning(f"Audio callback status: {status}")
                return
                
            # Skip processing if bot is speaking
            guild_id = next((gid for gid, stream in self.streams.items() if stream), None)
            if guild_id is None or self.is_speaking.get(guild_id, False):
                return
                
            # Ensure audio data is in the correct format (16-bit PCM)
            audio_data = (indata * 32767).astype(np.int16)
            audio_bytes = audio_data.tobytes()
            
            recognizer = self.recognizers.get(guild_id)
            if not recognizer:
                return
                
            if recognizer.AcceptWaveform(audio_bytes):
                result = json.loads(recognizer.Result())
                logger.debug(f"Full Vosk result: {result}")
                
                if result.get("text"):
                    text = result["text"].lower()
                    logger.info(f"Recognized text: {text}")
                    
                    if "bot" in text:
                        logger.info("Keyword 'bot' detected, preparing to trigger callback")
                        logger.debug(f"Callback details - Function: {self.callback.__name__ if hasattr(self.callback, '__name__') else type(self.callback)}")
                        logger.debug(f"Bot loop state - Running: {self.bot.loop.is_running()}, Closed: {self.bot.loop.is_closed()}")
                        
                        try:
                            # Get the current speaking user
                            current_user = self.speaking_users.get(guild_id)
                            user_id = str(current_user.id) if current_user else "unknown_user"
                            
                            future = asyncio.run_coroutine_threadsafe(
                                self.callback(guild_id, text, user_id),
                                self.bot.loop
                            )
                            logger.debug("Callback scheduled successfully")
                            future.add_done_callback(self._handle_callback_result)
                        except Exception as e:
                            logger.error(f"Failed to schedule callback: {e}")
                            logger.error(f"Stack trace: {traceback.format_exc()}")
            else:
                # Process partial results
                partial = json.loads(recognizer.PartialResult())
                if partial.get("partial"):
                    logger.debug(f"Partial result: {partial['partial']}")
        
        except Exception as e:
            logger.error(f"Error in audio callback: {e}")
            logger.error(f"Stack trace: {traceback.format_exc()}")
        
    def _handle_callback_result(self, future):
        """Handle the result of the callback execution"""
        try:
            future.result()  # This will raise any exceptions that occurred
            logger.debug("Callback completed successfully")
        except Exception as e:
            logger.error(f"Callback failed with error: {e}")
            logger.error(f"Stack trace: {traceback.format_exc()}")
            
    def stop_listening(self, guild_id: int) -> None:
        """Stop listening for audio in the specified guild"""
        logger.info(f"Stopping listening in guild {guild_id}")
        if guild_id in self.is_listening:
            self.is_listening[guild_id] = False
            
            # Stop and clean up the audio stream
            if guild_id in self.streams:
                try:
                    logger.debug("Stopping audio stream")
                    self.streams[guild_id].stop()
                    self.streams[guild_id].close()
                    del self.streams[guild_id]
                    logger.info("Audio stream stopped and cleaned up")
                except Exception as e:
                    logger.error(f"Error stopping audio stream: {e}")
                    logger.error(f"Stack trace: {traceback.format_exc()}")
            
            logger.info("Stopped listening")
            
    async def speak(self, guild_id: int, text: str) -> None:
        """Convert text to speech and play it in the voice channel"""
        logger.info(f"Attempting to speak in guild {guild_id}: {text[:50]}...")
        
        if guild_id not in self.voice_clients:
            logger.error("Not in a voice channel for this guild")
            return
            
        voice_client = self.voice_clients[guild_id]
        
        try:
            # Set speaking flag
            self.is_speaking[guild_id] = True
            
            # Generate speech using gTTS
            logger.info("Generating speech with gTTS")
            tts = gTTS(text=text, lang='en')
            
            # Save to temporary file
            logger.info("Saving speech to temporary file")
            with tempfile.NamedTemporaryFile(delete=False, suffix='.mp3') as fp:
                temp_filename = fp.name
                logger.info(f"Temporary file created: {temp_filename}")
                tts.save(temp_filename)
                
                # Check if file exists and has content
                if not os.path.exists(temp_filename):
                    logger.error("Temporary file was not created")
                    return
                    
                file_size = os.path.getsize(temp_filename)
                logger.info(f"Generated audio file size: {file_size} bytes")
                
                # Check if voice client is still connected
                if not voice_client.is_connected():
                    logger.error("Voice client is no longer connected")
                    os.unlink(temp_filename)
                    return
                
                try:
                    # Configure FFmpeg options
                    ffmpeg_options = {
                        'options': '-loglevel warning',
                        'before_options': '-nostdin -y'
                    }
                    
                    # Create audio source
                    logger.info("Creating FFmpeg audio source")
                    audio_source = discord.FFmpegPCMAudio(
                        temp_filename,
                        **ffmpeg_options
                    )
                    
                    # Add volume transformation
                    audio_source = discord.PCMVolumeTransformer(audio_source, volume=1.0)
                    
                    # Play the audio
                    logger.info("Starting audio playback")
                    voice_client.play(
                        audio_source,
                        after=lambda e: self._handle_playback_completion(e, temp_filename)
                    )
                    
                    # Wait until audio is finished playing or timeout
                    timeout = 30  # Maximum wait time in seconds
                    start_time = time.time()
                    while voice_client.is_playing():
                        await asyncio.sleep(0.1)
                        if time.time() - start_time > timeout:
                            logger.warning("Audio playback timed out")
                            voice_client.stop()
                            break
                            
                    logger.info("Audio playback completed")
                    
                except Exception as e:
                    logger.error(f"Error during audio playback: {str(e)}")
                    logger.error(f"Stack trace: {traceback.format_exc()}")
                    # Ensure cleanup
                    if os.path.exists(temp_filename):
                        os.unlink(temp_filename)
                    # Stop any ongoing playback
                    if voice_client.is_playing():
                        voice_client.stop()
                    
        except Exception as e:
            logger.error(f"Error in speak function: {str(e)}")
            logger.error(f"Stack trace: {traceback.format_exc()}")
        finally:
            # Clear speaking flag
            self.is_speaking[guild_id] = False
            
    def _handle_playback_completion(self, error, filename: str):
        """Handle cleanup after audio playback"""
        try:
            if error:
                logger.error(f"Error during playback: {str(error)}")
                logger.error(f"Stack trace: {traceback.format_exc()}")
            
            # Ensure the file is deleted
            if os.path.exists(filename):
                try:
                    os.unlink(filename)
                    logger.info(f"Temporary file {filename} deleted")
                except Exception as e:
                    logger.error(f"Error deleting temporary file: {str(e)}")
                    logger.error(f"Stack trace: {traceback.format_exc()}")
        except Exception as e:
            logger.error(f"Error in playback completion handler: {str(e)}")
            logger.error(f"Stack trace: {traceback.format_exc()}") 