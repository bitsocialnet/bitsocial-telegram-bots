# Bitsocial Telegram Bots

Telegram feed bots for [Bitsocial](https://github.com/bitsocialhq) clients. Each bot monitors a specific client's community list and forwards new posts to Telegram channels/groups.

## Available Bots

### 5chan Feed

Monitors all [5chan](https://github.com/bitsocialhq/5chan) directories (boards) from [`5chan-directories.json`](https://github.com/bitsocialhq/lists/blob/master/5chan-directories.json) and posts new content to Telegram. Each post includes buttons to view it on 5chan and Seedit.

### Seedit Feed *(planned)*

Will monitor [Seedit](https://github.com/bitsocialhq/seedit) communities and post new content to Telegram.

## Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/bitsocialhq/bitsocial-telegram-bots.git
   cd bitsocial-telegram-bots
   ```

2. **Install dependencies:**
   ```bash
   yarn install
   ```

3. **Create a `.env` file** in the root directory:
   ```env
   # Required: Telegram Bot Token from @BotFather
   BOT_TOKEN=your_telegram_bot_token_here

   # Which bot to run (defaults to 5chan-feed)
   BOT_NAME=5chan-feed

   # Required: At least one destination must be set
   FEED_BOT_CHAT=-1001234567890
   FEED_BOT_GROUP=-1001234567891
   ```

4. **Start the bot:**
   ```bash
   yarn start
   ```

   Or run a specific bot:
   ```bash
   yarn start:5chan-feed
   ```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | Yes | Telegram bot token from [@BotFather](https://t.me/botfather) |
| `BOT_NAME` | No | Which bot config to use (default: `5chan-feed`) |
| `FEED_BOT_CHAT` | Yes* | Primary Telegram chat/channel ID |
| `FEED_BOT_GROUP` | No | Secondary Telegram group ID |

\* At least one of `FEED_BOT_CHAT` or `FEED_BOT_GROUP` must be set.

## How It Works

1. The bot fetches the community list for the configured client (e.g. `5chan-directories.json` for 5chan)
2. It cycles through each community, checking for new posts via Plebbit
3. New posts are formatted and sent to the configured Telegram destinations with inline buttons linking back to the client
4. Processed post CIDs are tracked in `history.json` to avoid duplicates
5. Cycles repeat every 30 seconds

## Adding a New Bot

To add a bot for a different Bitsocial client:

1. Add a new config in `src/bot-configs.ts` with the client's list URL, community parser, and URL templates
2. Add a corresponding `start:` script in `package.json`
3. Deploy with a separate `.env` pointing to a different `BOT_TOKEN` and `BOT_NAME`

## License

GPL-2.0
