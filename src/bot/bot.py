import os
import discord
from discord.ext import commands
from dotenv import load_dotenv
from openai import AsyncOpenAI
import asyncio
from typing import Optional
import logging
from aiohttp import web

from ..utils.conversation_handler import ConversationHandler
from ..voice.voice_handler import VoiceHandler

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('Bot')

# Load environment variables
load_dotenv()
TOKEN = os.getenv('DISCORD_TOKEN')
DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY')
DEEPSEEK_API_BASE = os.getenv('DEEPSEEK_API_BASE')

# Add debug print
if not TOKEN:
    raise ValueError("No token found in environment variables! Check your .env file.")
logger.info("Token loaded: %s...", TOKEN[:10] if TOKEN else "None")

# Initialize OpenAI client for DeepSeek
ai_client = AsyncOpenAI(
    api_key=DEEPSEEK_API_KEY,
    base_url=DEEPSEEK_API_BASE
)

# Set up bot with command prefix '!'
intents = discord.Intents.default()
intents.message_content = True
intents.voice_states = True  # Required for voice functionality
bot = commands.Bot(command_prefix='!', intents=intents)

# Initialize handlers
conversation_handler = ConversationHandler()
voice_handler = VoiceHandler(bot)

# Create web app for health checks
app = web.Application()

async def health_check(request):
    """Health check endpoint"""
    return web.Response(text='OK', status=200)

app.router.add_get('/health', health_check)

async def generate_response(id: int, new_message: dict, guild_id: Optional[int] = None, is_voice: bool = False) -> str:
    """Generate a response using the AI model"""
    logger.info("Generating response for %s (voice: %s)", id, is_voice)
    
    # Get conversation history
    history = conversation_handler.get_history(id, is_voice)
    logger.info("Got conversation history with %d messages", len(history))
    
    # Keep system message plus last N messages
    messages = [
        history[0],  # System message
        *history[max(1, len(history) - conversation_handler.max_history + 1):],  # Last N-1 messages
        new_message  # Current message
    ]
    
    try:
        # Call DeepSeek API
        logger.info("Calling DeepSeek API")
        response = await ai_client.chat.completions.create(
            model="deepseek-chat",
            messages=messages,
            max_tokens=1000,
            temperature=0.7,
            user=new_message.get('name')
        )
        
        response_text = response.choices[0].message.content
        logger.info("Generated response: %s...", response_text[:50])
        return response_text
    except Exception as e:
        logger.error("Error generating response: %s", e)
        raise

async def handle_voice_message(guild_id: int, text: str) -> None:
    """Handle a voice message and generate a response"""
    logger.info("Handling voice message in guild %d: %s", guild_id, text)
    
    # Format the message
    user_id = "voice_user"  # You might want to track the actual speaking user
    message = conversation_handler.format_user_message(user_id, text)
    
    try:
        # Add message to history
        logger.info("Adding message to voice history")
        conversation_handler.add_message(guild_id, message, is_voice=True)
        
        # Generate response
        logger.info("Generating response for voice message")
        response_text = await generate_response(guild_id, message, guild_id, is_voice=True)
        
        # Add response to history
        logger.info("Adding response to voice history")
        conversation_handler.add_message(
            guild_id,
            conversation_handler.format_assistant_message(response_text),
            is_voice=True
        )
        
        # Speak the response
        logger.info("Speaking response: %s...", response_text[:50])
        await voice_handler.speak(guild_id, response_text)
    except Exception as e:
        logger.error("Error handling voice message: %s", e)

@bot.event
async def on_ready():
    logger.info('%s has connected to Discord!', bot.user)
    logger.info('Bot is in %d guilds', len(bot.guilds))

@bot.event
async def on_message(message):
    # Ignore messages from this bot
    if message.author == bot.user:
        return
        
    # Process commands first
    await bot.process_commands(message)
    
    # Handle YAGPDB.xyz welcome messages
    if message.author.id == 204255221017214977:  # YAGPDB.xyz's ID
        if any(keyword in message.content.lower() for keyword in ['welcome', 'joined', 'welcomed']):
            async with message.channel.typing():
                new_message = conversation_handler.format_user_message(
                    str(message.author.id),
                    f"I just welcomed a new user with this message: {message.content}"
                )
                
                conversation_handler.add_message(message.channel.id, new_message)
                response_text = await generate_response(message.channel.id, new_message, message.guild.id)
                conversation_handler.add_message(
                    message.channel.id,
                    conversation_handler.format_assistant_message(response_text)
                )
                
                await asyncio.sleep(1)
                await message.channel.send(response_text)
            return
    
    # If message starts with prefix, don't process it as conversation
    if message.content.startswith(bot.command_prefix):
        return
        
    # Add message to history
    new_message = conversation_handler.format_user_message(str(message.author.id), message.content)
    conversation_handler.add_message(message.channel.id, new_message)
    
    # If bot is mentioned or message is in DM, generate and send response
    if bot.user.mentioned_in(message) or isinstance(message.channel, discord.DMChannel):
        async with message.channel.typing():
            try:
                response_text = await generate_response(message.channel.id, new_message, message.guild.id)
                conversation_handler.add_message(
                    message.channel.id,
                    conversation_handler.format_assistant_message(response_text)
                )
                
                # Split and send response
                max_length = 1900
                chunks = [response_text[i:i + max_length] for i in range(0, len(response_text), max_length)]
                for chunk in chunks:
                    await message.channel.send(chunk)
                    
            except Exception as e:
                await message.channel.send(f"Sorry <@{message.author.id}>, I encountered an error: {str(e)}")

@bot.command(name='join')
async def join(ctx):
    """Join the user's voice channel"""
    logger.info("Join command received from %s in guild %s", ctx.author, ctx.guild)
    
    if not ctx.author.voice:
        logger.info("User not in a voice channel")
        await ctx.send("You need to be in a voice channel for me to join!")
        return
        
    if await voice_handler.join_voice_channel(ctx.author.voice.channel):
        logger.info("Successfully joined voice channel %s", ctx.author.voice.channel)
        await ctx.send("👋 I've joined your voice channel! Say 'bot' to get my attention!")
        await voice_handler.start_listening(ctx.guild.id, handle_voice_message)
    else:
        logger.error("Failed to join voice channel")
        await ctx.send("❌ I couldn't join the voice channel!")

@bot.command(name='leave')
async def leave(ctx):
    """Leave the voice channel"""
    logger.info("Leave command received from %s in guild %s", ctx.author, ctx.guild)
    await voice_handler.leave_voice_channel(ctx.guild.id)
    await ctx.send("👋 See ya!")

@bot.command(name='clear')
async def clear(ctx):
    """Clear the conversation history"""
    logger.info("Clear command received from %s in guild %s", ctx.author, ctx.guild)
    conversation_handler.clear_history(ctx.channel.id, guild_id=ctx.guild.id)
    conversation_handler.clear_history(ctx.guild.id, is_voice=True, guild_id=ctx.guild.id)
    await ctx.send("🧹 Conversation history cleared!")

@bot.command(name='ping')
async def ping(ctx):
    """Check bot latency"""
    latency = round(bot.latency * 1000)
    logger.info("Ping command received. Latency: %dms", latency)
    await ctx.send(f'Pong! Latency: {latency}ms')

async def start_bot():
    """Start both the bot and the health check server"""
    # Start health check server
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', 8080)
    await site.start()
    logger.info("Health check server started on port 8080")
    
    # Start the bot
    try:
        await bot.start(TOKEN)
    finally:
        await runner.cleanup()

if __name__ == '__main__':
    # Run both the bot and health check server
    asyncio.run(start_bot()) 