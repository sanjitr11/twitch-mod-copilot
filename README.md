# Twitch Moderation Co-Pilot

A human-in-the-loop chat moderation system for Twitch with intelligent sampling, real-time flagging, and a web-based dashboard.

## Features

### Phase 1 (Current)
- ✅ **Zero paid dependencies** - Runs entirely locally
- ✅ **Intelligent sampling** - Automatically adjusts sampling rate during raids
- ✅ **Rule-based moderation** - Detects hate speech, harassment, sexual content, spam, and coordinated attacks
- ✅ **Real-time dashboard** - WebSocket-powered live updates
- ✅ **Human-in-the-loop** - All moderation actions require human approval
- ✅ **SQLite storage** - Persistent flag history and user tracking
- ✅ **Context-aware** - Shows surrounding chat messages for better decision-making
- ✅ **User risk scoring** - Tracks repeat offenders

### Future Phases
- 🔄 **LLM integration** - Swap rule-based engine with Ollama or hosted models
- 🔄 **Twitch API actions** - Automated bans/timeouts when configured
- 🔄 **Advanced analytics** - Trends, patterns, and insights

## Architecture

```
twitch-mod-copilot/
├── apps/
│   ├── server/          # Node.js backend
│   │   ├── src/
│   │   │   ├── index.ts           # Main entry point
│   │   │   ├── twitch-client.ts   # tmi.js integration
│   │   │   ├── sampler.ts         # Intelligent message sampling
│   │   │   ├── moderation-engine.ts # Pluggable classification
│   │   │   ├── message-processor.ts # Batch processing & flagging
│   │   │   ├── database.ts        # SQLite operations
│   │   │   ├── websocket.ts       # Real-time updates
│   │   │   ├── api.ts             # REST endpoints
│   │   │   ├── action-handler.ts  # Moderation actions
│   │   │   └── types.ts           # Shared types
│   │   └── package.json
│   └── dashboard/       # Next.js frontend
│       ├── app/
│       │   ├── page.tsx           # Main dashboard
│       │   ├── components/        # React components
│       │   ├── hooks/             # WebSocket hook
│       │   └── types.ts           # Shared types
│       └── package.json
└── package.json         # Root workspace config
```

## Prerequisites

- **Node.js** >= 18.0.0
- **pnpm** >= 8.0.0
- **Twitch Account** for the bot

## Installation

1. **Clone or create the project directory:**
   ```bash
   cd twitch-mod-copilot
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```

4. **Configure Twitch credentials (see next section)**

## Twitch Setup

### Step 1: Create a Twitch Bot Account

1. Create a new Twitch account for your bot (e.g., `yourbot_moderation`)
2. Make the bot account a moderator in your channel: `/mod yourbot_moderation`

### Step 2: Get OAuth Token

**Option A: Using Twitch Chat OAuth Generator (Easiest)**
1. Visit https://twitchapps.com/tmi/
2. Log in with your **bot account**
3. Authorize the application
4. Copy the OAuth token (starts with `oauth:`)

**Option B: Using Twitch Developer Console**
1. Go to https://dev.twitch.tv/console/apps
2. Register a new application
3. Set OAuth Redirect URL to `http://localhost:3000`
4. Note your Client ID
5. Use the OAuth implicit flow to get a token with `chat:read` scope

### Step 3: Configure .env File

Edit `.env` with your credentials:

```bash
# Required
TWITCH_BOT_USERNAME=yourbot_moderation
TWITCH_OAUTH_TOKEN=oauth:your_token_here
TWITCH_CHANNEL=your_channel_name

# Optional - for Phase 2 (actual ban/timeout actions)
# TWITCH_MOD_TOKEN=your_moderator_token
# TWITCH_BROADCASTER_ID=your_broadcaster_id

# Sampling configuration (defaults shown)
BASE_SAMPLING_RATE=0.10
RAID_SAMPLING_RATE=0.40
RAID_MSGS_PER_SEC=10

# Server config
PORT=3001
DATABASE_PATH=./data/moderation.db

# Dashboard config
NEXT_PUBLIC_WS_URL=ws://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Running the Application

### Development Mode

Start both server and dashboard:
```bash
pnpm dev
```

This will start:
- **Server** on http://localhost:3001
- **Dashboard** on http://localhost:3000

### Production Mode

Build and run:
```bash
pnpm build
cd apps/server && pnpm start &
cd apps/dashboard && pnpm start &
```

## Testing

1. **Connect to a channel:**
   - Make sure `TWITCH_CHANNEL` is set to an active channel
   - Start the application with `pnpm dev`
   - You should see: `[Twitch] Connected to irc-ws.chat.twitch.tv:443`

2. **Generate test flags:**
   - Post messages in chat that trigger rules (see moderation patterns below)
   - Watch the dashboard for real-time flag notifications

3. **Test moderation actions:**
   - Click "Dismiss" to remove a flag
   - Click timeout/ban buttons (will be stubbed unless `TWITCH_MOD_TOKEN` is configured)
   - Check server logs for action confirmations

## Moderation Engine

### Current: Rule-Based Classifier

The Phase 1 engine uses regex patterns to detect:

| Violation Type | Examples | Recommended Action |
|----------------|----------|-------------------|
| **Hate Speech** | Slurs, discriminatory language | Ban |
| **Harassment** | Threats, telling users to harm themselves | Timeout 24h |
| **Sexual Content** | Pornographic links, solicitation | Timeout 1h |
| **Spam** | Repetitive characters, suspicious links | Timeout 1h |
| **Coordinated Attack** | Multiple users posting similar messages | Timeout 1h |

### Sampling Logic

Messages are sampled based on:
- **New users** - Always sampled (users not seen in last 15 minutes)
- **Flagged history** - Always sampled if user has prior violations
- **Base rate** - 10% of remaining messages (configurable)
- **Raid mode** - 40% sampling when chat velocity > 10 msgs/sec (configurable)

### Future: LLM-Based Classifier

To swap to an LLM-based moderation engine:

**Option 1: Local with Ollama**
```typescript
// apps/server/src/moderation-engine.ts
export class OllamaModerationEngine implements IModerationEngine {
  async classify(message: ChatMessage, context: ChatMessage[]): Promise<ModerationResult> {
    const prompt = `
      Analyze this Twitch chat message for policy violations.

      Message: "${message.message_text}"
      User: ${message.username}

      Context (recent messages):
      ${context.map(c => `${c.username}: ${c.message_text}`).join('\n')}

      Respond with JSON only:
      {
        "violation_type": "hate_speech|harassment|sexual_content|spam|coordinated_attack|none",
        "confidence": 0.0-1.0,
        "reasoning": "brief explanation",
        "recommended_action": "flag|timeout_1h|timeout_24h|ban|none"
      }
    `;

    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama2',
        prompt,
        stream: false,
      }),
    });

    const data = await response.json();
    return JSON.parse(data.response);
  }
}
```

**Option 2: Hosted API (OpenAI, Anthropic, etc.)**
```typescript
export class HostedLLMModerationEngine implements IModerationEngine {
  constructor(private apiKey: string) {}

  async classify(message: ChatMessage, context: ChatMessage[]): Promise<ModerationResult> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{
          role: 'system',
          content: 'You are a Twitch chat moderator. Analyze messages and respond with JSON only.',
        }, {
          role: 'user',
          content: `Analyze: "${message.message_text}". Context: ${JSON.stringify(context)}`,
        }],
        response_format: { type: 'json_object' },
      }),
    });

    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  }
}
```

**Update index.ts to use new engine:**
```typescript
// Replace this line:
const moderationEngine = new RuleBasedModerationEngine();

// With:
const moderationEngine = new OllamaModerationEngine();
// or
const moderationEngine = new HostedLLMModerationEngine(process.env.OPENAI_API_KEY!);
```

## API Reference

### REST Endpoints

**GET /api/flags**
- Query params: `status` (pending|dismissed|actioned), `limit` (default: 50)
- Returns: Array of flags with message data

**POST /api/flags/:id/dismiss**
- Marks flag as dismissed

**POST /api/flags/:id/action**
- Body: `{ action: "timeout_1h"|"timeout_24h"|"ban", username: string, channel: string }`
- Executes moderation action

**GET /api/users/:username/history**
- Query params: `channel`
- Returns: User violation history and risk score

### WebSocket Events

**Server → Client**
```typescript
// New flag created
{
  type: 'flag.created',
  data: {
    flag: Flag,
    message: Message,
    context: ChatMessage[]
  }
}

// System status update
{
  type: 'system.status',
  data: {
    queueDepth: number,
    samplingRate: number,
    raidMode: boolean
  }
}
```

## Database Schema

### messages
- `id` - Message hash (channel:username:text:timestamp)
- `channel` - Twitch channel
- `username` - User who sent message
- `message_text` - Message content
- `received_at` - Timestamp
- `sampled_reason` - Why this message was sampled
- `metadata_json` - Additional data

### flags
- `id` - Auto-increment primary key
- `message_id` - Foreign key to messages
- `violation_type` - Type of violation detected
- `confidence` - 0.0-1.0 confidence score
- `reasoning` - Explanation from classifier
- `recommended_action` - Suggested action
- `status` - pending|dismissed|actioned
- `created_at` - When flag was created
- `reviewed_at` - When human reviewed

### user_history
- `channel` - Twitch channel
- `username` - User
- `total_flags` - Count of violations
- `total_actions` - Count of bans/timeouts
- `last_violation_at` - Most recent violation
- `risk_score` - 0.0-1.0 risk assessment

## Troubleshooting

### "Missing required environment variables"
- Ensure `.env` file exists with `TWITCH_BOT_USERNAME`, `TWITCH_OAUTH_TOKEN`, and `TWITCH_CHANNEL`
- Verify OAuth token starts with `oauth:`

### WebSocket won't connect
- Check that server is running on port 3001
- Verify `NEXT_PUBLIC_WS_URL` matches server port
- Check browser console for connection errors

### No flags appearing
- Verify bot is connected: Check server logs for "Connected to irc-ws.chat.twitch.tv"
- Test with known violation: Post a message with banned words in chat
- Check sampling rate: Reduce `BASE_SAMPLING_RATE` to 1.0 for testing
- Ensure channel has active chat

### Actions not executing
- Phase 1 only logs actions (stub implementation)
- To enable real actions, configure `TWITCH_MOD_TOKEN` and `TWITCH_BROADCASTER_ID`
- Ensure bot account has moderator privileges in channel

## Configuration Tuning

### Sampling Rates
- **BASE_SAMPLING_RATE (0.10)** - Normal chat sampling percentage
  - Increase for more coverage, higher processing cost
  - Decrease for less load, might miss violations

- **RAID_SAMPLING_RATE (0.40)** - Raid mode sampling percentage
  - Automatically activates during high-velocity chat
  - Should be higher than base rate

- **RAID_MSGS_PER_SEC (10)** - Threshold for raid mode
  - Lower = more sensitive to spikes
  - Higher = only activates during major raids

### Database Location
- Default: `./data/moderation.db`
- Change `DATABASE_PATH` to use different location
- Database auto-creates on first run

## Contributing

This is a Phase 1 prototype. Future improvements:
- [ ] Twitch API integration for automated actions
- [ ] LLM-based moderation
- [ ] Advanced analytics dashboard
- [ ] Multi-channel support
- [ ] Moderator team collaboration
- [ ] Appeal system
- [ ] Custom rule builder UI

## License

MIT

## Support

For issues or questions:
1. Check logs in server console
2. Verify Twitch credentials
3. Test with known violation messages
4. Check database file was created

## Acknowledgments

Built with:
- [tmi.js](https://github.com/tmijs/tmi.js) - Twitch chat client
- [Next.js](https://nextjs.org/) - Dashboard framework
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - Database
- [ws](https://github.com/websockets/ws) - WebSocket server
