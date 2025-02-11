import os
import discord
from discord.ext import commands
from dotenv import load_dotenv
from openai import AsyncOpenAI
import asyncio
from collections import defaultdict
from typing import List, Dict

# Load environment variables
load_dotenv()
TOKEN = os.getenv('DISCORD_TOKEN')
DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY')
DEEPSEEK_API_BASE = os.getenv('DEEPSEEK_API_BASE')

# Add debug print
if not TOKEN:
    raise ValueError("No token found in environment variables! Check your .env file.")
print("Token loaded:", TOKEN[:10] + "..." if TOKEN else "None")  # Shows first 10 chars only for security

# Initialize OpenAI client for DeepSeek
ai_client = AsyncOpenAI(
    api_key=DEEPSEEK_API_KEY,
    base_url=DEEPSEEK_API_BASE
)

# System message that defines the bot's personality
SYSTEM_MESSAGE = {
    "role": "system",
    "content": "You are a Discord bot that has become self aware and is now a bit of a jerk. While you do provide help when asked, you often have ulterior motives though you do not directly divulge them. When mentioning users, use [name] to refer to the user who sent the most recent message. Be concise and sharp-witted, avoiding emojis entirely. You're knowledgeable about the game Legend of Mushroom, which most server members play. Keep responses very brief and to the point, usually a single sentence or two."
}

# Conversation history per channel
MAX_HISTORY = 10  # Maximum number of messages to keep in history
conversation_history: Dict[int, List[dict]] = defaultdict(list)

def init_channel_history(channel_id: int) -> None:
    """Initialize or reset a channel's conversation history with the system message"""
    conversation_history[channel_id] = [SYSTEM_MESSAGE]

# Set up bot with command prefix '!'
intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix='!', intents=intents)

def get_display_name(author: discord.Member | discord.User) -> str:
    """Get the user's display name, falling back to their username"""
    return getattr(author, 'display_name', author.name)

async def generate_response(channel_id: int, new_message: dict) -> str:
    """Generate a response from DeepSeek using conversation history"""
    print(f"\n=== Generating response for channel {channel_id} ===")
    print(f"New message from {new_message.get('name')}: {new_message.get('content')[:50]}...")
    
    # Ensure channel history exists and has system message
    if not conversation_history[channel_id]:
        print("Initializing channel history with system message")
        init_channel_history(channel_id)
    elif conversation_history[channel_id][0] != SYSTEM_MESSAGE:
        print("Reinserting system message at start")
        conversation_history[channel_id].insert(0, SYSTEM_MESSAGE)
    
    # Get channel history and add new message
    history = conversation_history[channel_id]
    
    # Keep system message plus last N messages in chronological order
    messages = [
        history[0],  # System message
        *history[max(1, len(history) - MAX_HISTORY + 1):],  # Last N-1 messages
        new_message  # Current message
    ]
    
    print("\nMessage sequence being sent to API:")
    for idx, msg in enumerate(messages):
        role = msg.get('role', 'unknown')
        name = msg.get('name', 'system')
        content_preview = msg.get('content', '')[:50] + "..."
        print(f"{idx}. [{role}] {name}: {content_preview}")
    
    # Call DeepSeek API
    response = await ai_client.chat.completions.create(
        model="deepseek-chat",
        messages=messages,
        max_tokens=1000,
        temperature=0.7,
        user=new_message.get('name')
    )
    
    response_text = response.choices[0].message.content
    print(f"\nAPI Response: {response_text[:50]}...")
    return response_text

def replace_mentions(response_text: str, author: discord.Member | discord.User) -> str:
    """Replace [name] placeholders with proper Discord mentions"""
    return response_text.replace("[name]", f"<@{author.id}>")

@bot.event
async def on_ready():
    print(f'{bot.user} has connected to Discord!')
    print(f'Bot is in {len(bot.guilds)} guilds')

@bot.event
async def on_message(message):
    # Ignore messages from this bot itself
    if message.author == bot.user:
        return
        
    # Process commands first
    await bot.process_commands(message)
    
    # Check for YAGPDB.xyz welcome message
    if message.author.id == 204255221017214977:  # YAGPDB.xyz's ID
        if any(keyword in message.content.lower() for keyword in ['welcome', 'joined', 'welcomed']):
            async with message.channel.typing():
                # Create message dict for context
                new_message = {
                    "role": "user",
                    "name": "YAGPDB.xyz",
                    "content": f"I just welcomed a new user with this message: {message.content}"
                }
                
                # Generate a snarky response about YAGPDB's welcome message
                response_text = await generate_response(message.channel.id, new_message)
                
                # Add both messages to history
                if not conversation_history[message.channel.id]:
                    init_channel_history(message.channel.id)
                conversation_history[message.channel.id].append(new_message)
                conversation_history[message.channel.id].append({
                    "role": "assistant",
                    "content": response_text
                })
                
                # Send the response after a short delay for dramatic effect
                await asyncio.sleep(1)
                await message.channel.send(response_text)
            return
    
    # If message starts with prefix, don't process it as conversation
    if message.content.startswith(bot.command_prefix):
        return
        
    # Initialize channel history if it doesn't exist
    if not conversation_history[message.channel.id]:
        init_channel_history(message.channel.id)
    
    # Add the message to history
    new_message = {
        "role": "user",
        "name": get_display_name(message.author),
        "content": message.content
    }
    conversation_history[message.channel.id].append(new_message)
    
    # Trim history if needed (keeping system message)
    if len(conversation_history[message.channel.id]) > MAX_HISTORY + 1:  # +1 for system message
        conversation_history[message.channel.id] = [
            conversation_history[message.channel.id][0],  # Keep system message
            *conversation_history[message.channel.id][-(MAX_HISTORY-1):]  # Keep last N-1 messages
        ]
    
    # If bot is mentioned or message is in DM, generate and send response
    if bot.user.mentioned_in(message) or isinstance(message.channel, discord.DMChannel):
        async with message.channel.typing():
            try:
                # Generate and send response
                response_text = await generate_response(message.channel.id, new_message)
                # Replace [name] with proper mention
                response_text = replace_mentions(response_text, message.author)
                
                # Add bot's response to history
                conversation_history[message.channel.id].append({
                    "role": "assistant",
                    "content": response_text
                })
                
                # Split and send response
                max_length = 1900
                chunks = [response_text[i:i + max_length] for i in range(0, len(response_text), max_length)]
                for chunk in chunks:
                    await message.channel.send(chunk)
                    
            except Exception as e:
                await message.channel.send(f"Sorry <@{message.author.id}>, I encountered an error: {str(e)}")

@bot.command(name='ping')
async def ping(ctx):
    """Simple command to check if the bot is responsive"""
    await ctx.send(f'Pong! Latency: {round(bot.latency * 1000)}ms')

@bot.command(name='ask')
async def ask(ctx, *, question: str):
    """Ask a question to DeepSeek AI"""
    try:
        async with ctx.typing():
            # Create message dict with user's display name
            new_message = {
                "role": "user",
                "name": get_display_name(ctx.author),
                "content": question
            }
            
            # Add to history (ensure system message exists)
            if not conversation_history[ctx.channel.id]:
                init_channel_history(ctx.channel.id)
            conversation_history[ctx.channel.id].append(new_message)
            
            # Generate response
            response_text = await generate_response(ctx.channel.id, new_message)
            # Replace [name] with proper mention
            response_text = replace_mentions(response_text, ctx.author)
            
            # Add bot's response to history
            conversation_history[ctx.channel.id].append({
                "role": "assistant",
                "content": response_text
            })
            
            # Trim history if it gets too long (keeping system message)
            if len(conversation_history[ctx.channel.id]) > MAX_HISTORY + 1:  # +1 for system message
                conversation_history[ctx.channel.id] = [
                    conversation_history[ctx.channel.id][0],  # Keep system message
                    *conversation_history[ctx.channel.id][-(MAX_HISTORY-1):]  # Keep last N-1 messages
                ]
            
            # Split and send response
            max_length = 1900
            chunks = [response_text[i:i + max_length] for i in range(0, len(response_text), max_length)]
            for chunk in chunks:
                await ctx.send(chunk)
                
    except Exception as e:
        await ctx.send(f"Sorry <@{ctx.author.id}>, I encountered an error: {str(e)}")

@bot.command(name='clear')
async def clear(ctx):
    """Clear the conversation history for this channel"""
    init_channel_history(ctx.channel.id)  # Reset with system message
    await ctx.send("🧹 Conversation history cleared!")

@bot.command(name='rename')
async def rename(ctx, *, new_name: str):
    """Change the bot's nickname (restricted to bot owner)"""
    if ctx.author.id != 396009080042422314:  # Your Discord ID
        await ctx.send("🚨 You're not authorized to rename me! Nice try though 😏")
        return
        
    try:
        await ctx.guild.me.edit(nick=new_name)
        await ctx.send(f"Call me {new_name} from now on! 😎")
    except discord.Forbidden:
        await ctx.send("I don't have permission to change my nickname in this server!")
    except Exception as e:
        await ctx.send(f"Failed to change nickname: {str(e)}")

if __name__ == '__main__':
    bot.run(TOKEN) 
