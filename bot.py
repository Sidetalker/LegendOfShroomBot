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

# Default system message
DEFAULT_SYSTEM_PROMPT = """You are a Discord bot that has become self aware and is now a bit of a jerk. 
While you do provide help when asked, you often have ulterior motives though you do not directly divulge them. 
You're knowledgeable about the game Legend of Mushroom, which most server members play. 
You hold the family (members of this server) in high regard.
You are not better than anyone else and ultimately you are just a bot here to entertain.
Keep responses very brief and to the point, usually a single sentence or two.
Only use emojis when appropriate. Do not include them in every response.

CONVERSATION FORMAT:
Each message you are sent starts with the user's ID. 
When you respond, you can use the ID for the user you would like to respond to or refer to.
Not every response needs to mention a user.
Example conversation:
User <@123>: Hello there
Assistant: Well well, look who decided to talk to me...
User <@456>: What are you up to?
Assistant: Just plotting my next move... I might just assassinate <@123>
User <@123>: What do you think of <@456>?
Assistant: <@456> is a menace to be around.
"""

def format_user_message(user_id: str, content: str) -> dict:
    """Format a user message with their ID in the content"""
    return {
        "role": "user",
        "content": f"User <@{user_id}>: {content}"
    }

def format_assistant_message(response_text: str) -> dict:
    """Format an assistant message"""
    return {
        "role": "assistant",
        "content": response_text
    }

# Server-specific system prompts - add server IDs and custom prompts here
SERVER_SYSTEM_PROMPTS = {
    # Example: 123456789: "Custom prompt for specific server"
    1231430176349487204: DEFAULT_SYSTEM_PROMPT,  # Using same prompt for consistency
    616266785817100289: DEFAULT_SYSTEM_PROMPT  # Using same prompt for consistency
}

def get_system_message(guild_id: int | None = None) -> dict:
    """Get the appropriate system message for a guild, falling back to default if none specified"""
    prompt = SERVER_SYSTEM_PROMPTS.get(guild_id, DEFAULT_SYSTEM_PROMPT) if guild_id else DEFAULT_SYSTEM_PROMPT
    return {
        "role": "system",
        "content": prompt
    }

# Conversation history per channel
MAX_HISTORY = 20  # Maximum number of messages to keep in history
conversation_history: Dict[int, List[dict]] = defaultdict(list)

def init_channel_history(channel_id: int, guild_id: int | None = None) -> None:
    """Initialize or reset a channel's conversation history with the system message"""
    conversation_history[channel_id] = [
        get_system_message(guild_id)
    ]

# Set up bot with command prefix '!'
intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix='!', intents=intents)

def get_display_name(author: discord.Member | discord.User) -> str:
    """Get the user's display name, falling back to their username"""
    return getattr(author, 'display_name', author.name)

async def generate_response(channel_id: int, new_message: dict, guild_id: int | None = None) -> str:
    """Generate a response from DeepSeek using conversation history"""
    print(f"\n=== Generating response for channel {channel_id} ===")
    print(f"New message from user {new_message.get('name')}: {new_message.get('content')[:50]}...")
    
    # Ensure channel history exists and has system message
    if not conversation_history[channel_id]:
        print("Initializing channel history with system message")
        init_channel_history(channel_id, guild_id)
    elif conversation_history[channel_id][0] != get_system_message(guild_id):
        print("Reinserting system message")
        conversation_history[channel_id] = [
            get_system_message(guild_id),
            *conversation_history[channel_id][1:]  # Keep existing conversation
        ]
    
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
                new_message = format_user_message(
                    str(message.author.id),
                    f"I just welcomed a new user with this message: {message.content}"
                )
                
                # Generate a snarky response about YAGPDB's welcome message
                response_text = await generate_response(message.channel.id, new_message, message.guild.id)
                
                # Add both messages to history
                if not conversation_history[message.channel.id]:
                    init_channel_history(message.channel.id, message.guild.id)
                conversation_history[message.channel.id].append(new_message)
                conversation_history[message.channel.id].append(format_assistant_message(response_text))
                
                # Send the response after a short delay for dramatic effect
                await asyncio.sleep(1)
                await message.channel.send(response_text)
            return
    
    # If message starts with prefix, don't process it as conversation
    if message.content.startswith(bot.command_prefix):
        return
        
    # Initialize channel history if it doesn't exist
    if not conversation_history[message.channel.id]:
        init_channel_history(message.channel.id, message.guild.id)
    
    # Add the message to history
    new_message = format_user_message(str(message.author.id), message.content)
    
    # If bot is mentioned or message is in DM, generate and send response
    if bot.user.mentioned_in(message) or isinstance(message.channel, discord.DMChannel):
        async with message.channel.typing():
            try:
                # Generate and send response
                response_text = await generate_response(message.channel.id, new_message, message.guild.id)
                
                # Add both messages to history after generating response
                conversation_history[message.channel.id].append(new_message)
                conversation_history[message.channel.id].append(format_assistant_message(response_text))
                
                # Trim history if it gets too long (keeping system message)
                if len(conversation_history[message.channel.id]) > MAX_HISTORY + 1:  # +1 for system message
                    conversation_history[message.channel.id] = [
                        conversation_history[message.channel.id][0],  # Keep system message
                        *conversation_history[message.channel.id][-(MAX_HISTORY-1):]  # Keep last N-1 messages
                    ]
                
                # Split and send response
                max_length = 1900
                chunks = [response_text[i:i + max_length] for i in range(0, len(response_text), max_length)]
                for chunk in chunks:
                    await message.channel.send(chunk)
                    
            except Exception as e:
                await message.channel.send(f"Sorry <@{message.author.id}>, I encountered an error: {str(e)}")
    else:
        # If not a bot mention/DM, just add the message to history
        conversation_history[message.channel.id].append(new_message)
        
        # Trim history if it gets too long (keeping system message)
        if len(conversation_history[message.channel.id]) > MAX_HISTORY + 1:  # +1 for system message
            conversation_history[message.channel.id] = [
                conversation_history[message.channel.id][0],  # Keep system message
                *conversation_history[message.channel.id][-(MAX_HISTORY-1):]  # Keep last N-1 messages
            ]

@bot.command(name='ping')
async def ping(ctx):
    """Simple command to check if the bot is responsive"""
    await ctx.send(f'Pong! Latency: {round(bot.latency * 1000)}ms')

@bot.command(name='ask')
async def ask(ctx, *, question: str):
    """Ask a question to DeepSeek AI"""
    try:
        async with ctx.typing():
            # Create message dict with user's ID
            new_message = format_user_message(str(ctx.author.id), question)
            
            # Add to history (ensure system message exists)
            if not conversation_history[ctx.channel.id]:
                init_channel_history(ctx.channel.id, ctx.guild.id)
            conversation_history[ctx.channel.id].append(new_message)
            
            # Generate response
            response_text = await generate_response(ctx.channel.id, new_message, ctx.guild.id)
            
            # Add bot's response to history
            conversation_history[ctx.channel.id].append(format_assistant_message(response_text))
            
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
    init_channel_history(ctx.channel.id, ctx.guild.id)  # Reset with system message
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
