# Architecture Overview

## System Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        TWITCH CHAT                              │
│                     (IRC WebSocket)                             │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ tmi.js
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TWITCH CLIENT                                │
│  - Connects to channel                                          │
│  - Receives all messages                                        │
│  - Generates message IDs (hash)                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MESSAGE SAMPLER                              │
│  - Tracks chat velocity                                         │
│  - New user detection (15min window)                            │
│  - Prior violator check (DB lookup)                             │
│  - Base sampling: 10%                                           │
│  - Raid mode: 40% (when msgs/sec > 10)                          │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ Sampled messages only
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                 MESSAGE PROCESSOR                               │
│  - Maintains context buffer (last 10 msgs/channel)              │
│  - Batches: every 2s OR 10 messages                             │
│  - Prevents duplicate flags (hash check)                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                MODERATION ENGINE                                │
│                 (Pluggable Interface)                           │
│                                                                 │
│  Phase 1: RuleBasedModerationEngine                             │
│  ┌──────────────────────────────────────┐                      │
│  │ - Regex patterns for violations      │                      │
│  │ - Coordinated attack detection        │                      │
│  │ - Returns: type, confidence, action   │                      │
│  └──────────────────────────────────────┘                      │
│                                                                 │
│  Phase 2: LLMModerationEngine                                   │
│  ┌──────────────────────────────────────┐                      │
│  │ - Ollama / OpenAI / Anthropic         │                      │
│  │ - Context-aware analysis              │                      │
│  │ - Natural language reasoning          │                      │
│  └──────────────────────────────────────┘                      │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
                   Violation detected?
                         │
              ┌──────────┴──────────┐
              │                     │
              NO                   YES
              │                     │
              ▼                     ▼
         (Discard)         ┌───────────────┐
                           │   FLAG        │
                           │   CREATED     │
                           └───────┬───────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
            ┌──────────────┐ ┌─────────┐  ┌──────────────┐
            │   DATABASE   │ │WEBSOCKET│  │USER HISTORY  │
            │              │ │         │  │              │
            │ - messages   │ │Broadcast│  │ +1 flag      │
            │ - flags      │ │to       │  │ +risk score  │
            │              │ │dashboard│  │              │
            └──────────────┘ └────┬────┘  └──────────────┘
                                  │
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DASHBOARD                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  STATS BAR                                               │  │
│  │  Connection | Flags/min | Sampling | Queue | Raid Mode  │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  FLAG FEED (Real-time)                                   │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ @username • hate_speech • 95%                      │  │  │
│  │  │ "offensive message here"                           │  │  │
│  │  │ Reasoning: Contains hate speech or slurs           │  │  │
│  │  │ [Context ▼]                                        │  │  │
│  │  │ [Dismiss] [1h] [24h] [Ban]                        │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  USER HISTORY PANEL (On click)                          │  │
│  │  Total Flags: 5                                         │  │
│  │  Total Actions: 2                                       │  │
│  │  Risk Score: █████░░░░░ 60%                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ Human clicks action
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                  ACTION HANDLER                                 │
│  Phase 1: STUB (logs only)                                      │
│  Phase 2: Twitch API calls                                      │
│  - /helix/moderation/bans (timeout)                             │
│  - /helix/moderation/bans (ban)                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Details

### 1. Message Ingestion
- Twitch Client connects via IRC WebSocket
- All messages received in real-time
- Message ID = MD5(channel:username:text:timestamp_rounded)
- Full firehose goes to Sampler

### 2. Sampling Decision Tree
```
Message arrives
    │
    ├─→ New user (not seen in 15min)? → SAMPLE (reason: new_user)
    │
    ├─→ Has prior flags in DB? → SAMPLE (reason: prior_flags)
    │
    ├─→ Chat velocity > 10 msg/s? → 40% chance SAMPLE (reason: raid_mode_sample)
    │
    └─→ Otherwise → 10% chance SAMPLE (reason: base_sample)
```

### 3. Batch Processing
- Messages queue in memory
- Batch triggers: 10 messages OR 2 seconds (whichever first)
- Duplicate check: hash exists in DB?
- Context: Last 10 messages per channel (not just sampled)

### 4. Classification
**Input:**
- Message: `{ id, channel, username, message_text, received_at }`
- Context: `Array<{ username, message_text, received_at }>`

**Output:**
```typescript
{
  violation_type: 'hate_speech' | 'harassment' | 'sexual_content' | 'spam' | 'coordinated_attack' | 'none',
  confidence: 0.0-1.0,
  reasoning: string,
  recommended_action: 'flag' | 'timeout_1h' | 'timeout_24h' | 'ban' | 'none'
}
```

### 5. Storage
**SQLite Tables:**
- `messages` - All sampled messages
- `flags` - Only violations (confidence >= 0.6)
- `user_history` - Aggregate stats per user

### 6. Real-time Updates
**WebSocket Events:**
```typescript
// Flag created
{ type: 'flag.created', data: { flag, message, context } }

// System status (every sampling change)
{ type: 'system.status', data: { queueDepth, samplingRate, raidMode } }
```

### 7. Human Actions
**Dashboard → API → ActionHandler → Database**
- Dismiss: Update flag status to 'dismissed'
- Timeout/Ban: Update flag status to 'actioned' + increment user actions

## Pluggable Moderation Engine

The `IModerationEngine` interface allows swapping classifiers:

```typescript
interface IModerationEngine {
  classify(message: ChatMessage, context: ChatMessage[]): Promise<ModerationResult>;
}
```

**Current:** `RuleBasedModerationEngine`
- Regex patterns
- No external dependencies
- Deterministic

**Future:** `LLMModerationEngine`
- LLM API calls (Ollama, OpenAI, etc.)
- Context-aware
- Natural language reasoning

**To swap:** Change one line in `apps/server/src/index.ts`

## Performance Characteristics

### Sampling Overhead
- Base rate (10%): 1 in 10 messages processed
- Raid mode (40%): 4 in 10 messages processed
- New users: Always processed (decays over 15min)
- Prior violators: Always processed

### Database Operations
- Batch inserts every 2 seconds
- Indexes on: flag status, created_at, username, risk_score
- Duplicate check: Hash lookup (indexed)

### WebSocket Broadcast
- Only flags broadcast (not all messages)
- System status broadcast on sampling rate changes
- Automatic reconnection on client

### Memory Usage
- Context buffer: 10 messages × N channels
- Message queue: Up to 10 messages before batch
- User tracking: Map of username → first_seen (auto-cleaned every 10s)

## Security Considerations

### Phase 1
- Read-only Twitch access (chat:read)
- No automated actions (human-in-loop)
- SQLite file-based (no network exposure)
- CORS enabled for localhost

### Phase 2 (Future)
- Moderator token required for actions
- Rate limiting on actions
- Audit log of all actions
- Role-based access control for dashboard
