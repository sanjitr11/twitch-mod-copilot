# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - Phase 1 - 2024

### Added
- Initial Phase 1 prototype implementation
- Twitch chat integration via tmi.js
- Intelligent message sampling with raid mode detection
- Rule-based moderation engine with pluggable interface
- SQLite database for persistent storage
- Real-time WebSocket updates to dashboard
- Next.js-based moderation dashboard
- Human-in-the-loop action workflow
- User history tracking and risk scoring
- Context-aware flagging (last 10 messages per channel)
- Batch processing (2s or 10 messages)
- Duplicate flag prevention
- Automatic WebSocket reconnection
- REST API for flag management
- Comprehensive documentation

### Moderation Engine
- Hate speech detection (regex-based)
- Harassment detection
- Sexual content detection
- Spam detection
- Coordinated attack detection (similarity matching)
- Confidence scoring (0.0-1.0)
- Recommended action suggestions

### Sampling Features
- New user priority sampling (15min window)
- Prior violator priority sampling
- Base sampling rate: 10% (configurable)
- Raid mode sampling: 40% (configurable)
- Automatic raid mode activation (10+ msgs/sec threshold)

### Dashboard Features
- Real-time flag feed with WebSocket
- Stats bar: connection status, flags/min, sampling rate, queue depth, raid mode
- Flag details: username, message, violation type, confidence, reasoning, timestamp
- Context preview (last 5 messages)
- User history panel: total flags, total actions, risk score, last violation
- Action buttons: Dismiss, Timeout 1h, Timeout 24h, Ban
- Top violations (15min rolling window)

### Known Limitations (Phase 1)
- Actions are stubbed (no actual Twitch API calls)
- New user detection is heuristic-based (not actual account age)
- Rule-based engine has false positives/negatives
- Single channel support only
- No dashboard authentication
- No moderator team features

## [Unreleased] - Phase 2 (Planned)

### Planned Features
- LLM-based moderation engine integration
- Actual Twitch API moderation actions
- OAuth flow for moderator authentication
- Multi-channel support
- Advanced analytics dashboard
- Moderator team collaboration
- Appeal system
- Custom rule builder UI
- Rate limiting on actions
- Audit log export
- Role-based access control

### Potential LLM Integrations
- Ollama (local)
- OpenAI GPT-4
- Anthropic Claude
- Custom fine-tuned models

## Migration Guide

### Future: Rule-Based → LLM Engine

When upgrading to LLM-based moderation:

1. Install LLM dependencies:
```bash
cd apps/server
pnpm add openai
# or for Ollama (no package needed, just HTTP calls)
```

2. Create new engine:
```typescript
// apps/server/src/moderation-engine.ts
export class LLMModerationEngine implements IModerationEngine {
  async classify(message: ChatMessage, context: ChatMessage[]): Promise<ModerationResult> {
    // Implementation
  }
}
```

3. Update initialization:
```typescript
// apps/server/src/index.ts
const moderationEngine = new LLMModerationEngine();
```

4. Test thoroughly before production use

### Database Schema Changes

No breaking changes planned. Future migrations will use sqlite migrations with backwards compatibility.
