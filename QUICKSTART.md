# Quick Start Guide

Get the Twitch Moderation Co-Pilot running in 5 minutes.

## 1. Install Dependencies

```bash
cd twitch-mod-copilot
pnpm install
```

## 2. Get Twitch OAuth Token

Visit https://twitchapps.com/tmi/ and:
1. Log in with your bot account
2. Click "Connect"
3. Copy the token (starts with `oauth:`)

## 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```bash
TWITCH_BOT_USERNAME=your_bot_username
TWITCH_OAUTH_TOKEN=oauth:your_token_here
TWITCH_CHANNEL=your_channel_name
```

## 4. Run the Application

```bash
pnpm dev
```

## 5. Open Dashboard

Visit http://localhost:3000

You should see:
- Connection status: "Live"
- Real-time flags appear as violations are detected
- Stats updating in real-time

## 6. Test It

Post a test message in your Twitch chat:
- Try posting: "test spam message" repeatedly
- Watch the dashboard for flags to appear
- Click "Dismiss" or action buttons

## That's It!

You now have a working moderation co-pilot. See [README.md](README.md) for advanced configuration and LLM integration.

## Common Issues

**"Missing required environment variables"**
→ Double-check your `.env` file has all three required variables

**No flags appearing**
→ Ensure your channel has active chat and BASE_SAMPLING_RATE is set to 1.0 for testing

**WebSocket won't connect**
→ Make sure server started successfully on port 3001
