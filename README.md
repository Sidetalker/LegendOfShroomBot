# Legend of Shroom Bot (JavaScript)

A Discord bot for the Legend of Mushroom server, implemented in JavaScript using Discord.js.

## Features

- Chat interaction with AI using DeepSeek API
- Conversation memory per channel
- Command system with basic commands:
  - `!ping` - Check bot latency
  - `!clear` - Clear conversation history

## Prerequisites

- Node.js 16.9.0 or higher
- npm (Node Package Manager)
- Discord Bot Token
- DeepSeek API Key

## Setup

1. Clone the repository
2. Navigate to the project directory
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a `.env` file in the root directory with the following variables:
   ```
   DISCORD_TOKEN=your_discord_bot_token
   DEEPSEEK_API_KEY=your_deepseek_api_key
   DEEPSEEK_API_BASE=https://api.deepseek.com/v1
   ```

## Running the Bot

For development (with auto-reload):
```bash
npm run dev
```

For production:
```bash
npm start
```

## Usage

1. Invite the bot to your server using the OAuth2 URL
2. The bot will respond when:
   - Mentioned (@bot)
   - Sent a direct message
   - Using commands with the `!` prefix

## Contributing

Feel free to submit issues and pull requests.

## License

ISC 