# Legend of Shroom Bot

A Discord bot built with discord.py.

## Setup Instructions

1. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure Environment Variables**
   - Copy the `.env` file template
   - Replace `your_token_here` with your Discord bot token
   - To get a token:
     1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
     2. Create a new application
     3. Go to the "Bot" section
     4. Click "Add Bot"
     5. Copy the token

3. **Run the Bot**
   ```bash
   python bot.py
   ```

## Available Commands
- `!ping` - Check if the bot is responsive

## Adding the Bot to Your Server
1. Go to the Discord Developer Portal
2. Select your application
3. Go to "OAuth2" → "URL Generator"
4. Select the following scopes:
   - `bot`
   - `applications.commands`
5. Select required bot permissions
6. Copy and open the generated URL
7. Select your server and authorize the bot

## Development
Feel free to add more commands in `bot.py`. The bot uses the command prefix `!`. 