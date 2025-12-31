# Testing Guide

This guide explains how to test the Twitch Moderation Co-Pilot end-to-end.

## Prerequisites

- Application installed and configured (see [QUICKSTART.md](QUICKSTART.md))
- Active Twitch channel with chat activity
- Bot account with moderator privileges

## Testing Checklist

### 1. Connection Test

**Start the application:**
```bash
pnpm dev
```

**Expected output:**
```
[Server] Starting Twitch Moderation Co-Pilot...
[Server] Initializing database...
[Server] HTTP server listening on port 3001
[Server] WebSocket available at ws://localhost:3001/ws
[Server] Connecting to Twitch channel: your_channel
[Twitch] Connected to irc-ws.chat.twitch.tv:443
[Server] All systems operational
```

**Dashboard check:**
- Open http://localhost:3000
- Verify "Connection: Live" shows green dot
- Stats bar should display current sampling rate

✅ **Pass:** Green connection indicator and no errors in console

### 2. Message Sampling Test

**Test new user sampling:**
1. Have a new user (not seen before) post in chat
2. Check server logs: `[Processor] Processing batch of N messages`
3. Message should be sampled with reason: `new_user`

**Test base sampling:**
1. Post several normal messages
2. ~10% should be sampled (check server logs)
3. Sampling reason: `base_sample`

**Test raid mode:**
1. Simulate high chat velocity (>10 msgs/sec)
2. Server should log: `[Sampler] Raid mode activated`
3. Dashboard stats should show "Mode: RAID MODE"
4. Sampling rate should increase to 40%

**Manual raid mode test:**
Edit `.env` to lower threshold temporarily:
```bash
RAID_MSGS_PER_SEC=3
```

✅ **Pass:** Sampling rates adjust correctly, raid mode activates

### 3. Violation Detection Test

**Test hate speech detection:**
Post these messages in chat (use test account in your own channel):
```
Test 1: Message with no violations
Test 2: [intentionally omitted - use actual violation for testing]
```

Expected: Test 2 should create a flag with type `hate_speech`

**Test spam detection:**
```
Test 3: AAAAAAAAAAAAAAAAAAAAAAAAA (excessive repetition)
Test 4: Free money click here bit.ly/scam
```

Expected: Both should flag as `spam`

**Test sexual content:**
```
Test 5: Check out my onlyfans.com profile
```

Expected: Flags as `sexual_content`

**Test ALL CAPS (low confidence):**
```
Test 6: THIS IS A REALLY LONG MESSAGE IN ALL CAPS
```

Expected: May flag as `spam` with lower confidence (~60%)

**Test coordinated attack:**
1. Have 3+ different users post similar messages within 30 seconds
2. Example: "User1: Follow @badactor", "User2: Follow @badactor", "User3: Follow @badactor"

Expected: Later messages flag as `coordinated_attack`

✅ **Pass:** Flags appear on dashboard with correct violation types

### 4. Dashboard Functionality Test

**Real-time flag feed:**
1. Create a violation (see above)
2. Flag should appear instantly on dashboard (no page refresh)
3. Verify all fields: username, message, violation type, confidence, reasoning, timestamp

**Context preview:**
1. Click "Context" dropdown on a flag
2. Should show last 5 messages before the violation
3. Usernames and timestamps should be visible

**User history:**
1. Click on a username in a flag
2. Right panel should slide in
3. Should show: total flags, total actions, risk score, last violation date

✅ **Pass:** All UI elements functional, real-time updates work

### 5. Action Handler Test

**Test dismiss:**
1. Click "Dismiss" on a flag
2. Flag should disappear from dashboard
3. Check server logs: Action confirmed
4. Database check: `SELECT * FROM flags WHERE id=X` → status='dismissed'

**Test timeout actions:**
1. Click "Timeout 1h"
2. Flag should disappear
3. Server logs: `[Action] Executing timeout_1h on user username`
4. Server logs: `[Action] STUB: Would execute timeout_1h` (Phase 1)

**Test ban action:**
1. Click "Ban"
2. Same behavior as timeout
3. Logs should show ban action stub

**Database verification:**
```bash
cd /Users/sanjitrameshkumar/twitch-mod-copilot
sqlite3 data/moderation.db
```

```sql
-- Check flag was actioned
SELECT * FROM flags WHERE status='actioned' ORDER BY reviewed_at DESC LIMIT 5;

-- Check user history updated
SELECT * FROM user_history WHERE total_actions > 0;

-- Verify risk score increased
SELECT username, total_flags, total_actions, risk_score
FROM user_history
ORDER BY risk_score DESC
LIMIT 10;
```

✅ **Pass:** Actions execute correctly, database updates reflect changes

### 6. WebSocket Reconnection Test

**Test automatic reconnection:**
1. Start application normally
2. Dashboard shows "Live"
3. Stop server (Ctrl+C)
4. Dashboard should show "Offline"
5. Check browser console: "WebSocket disconnected, reconnecting in 3s..."
6. Restart server
7. Dashboard should reconnect automatically within 3 seconds

✅ **Pass:** Reconnection works without page refresh

### 7. API Endpoint Test

**Using curl or Postman:**

```bash
# Get pending flags
curl http://localhost:3001/api/flags?status=pending&limit=10

# Get user history
curl "http://localhost:3001/api/users/testuser/history?channel=yourchannel"

# Dismiss flag
curl -X POST http://localhost:3001/api/flags/1/dismiss

# Execute action
curl -X POST http://localhost:3001/api/flags/2/action \
  -H "Content-Type: application/json" \
  -d '{"action":"timeout_1h","username":"testuser","channel":"yourchannel"}'

# Health check
curl http://localhost:3001/health
```

✅ **Pass:** All endpoints return expected JSON

### 8. Performance Test

**Simulate high-volume chat:**

Create a test script (`test-volume.js`):
```javascript
const tmi = require('tmi.js');

const client = new tmi.Client({
  channels: ['yourchannel']
});

client.connect();

let count = 0;
setInterval(() => {
  client.say('yourchannel', `Test message ${count++}`);
}, 100); // 10 msgs/sec
```

**Monitor:**
- Server CPU usage (should stay low)
- Dashboard responsiveness (no lag)
- Database size growth
- Memory usage in server logs

**Expected:**
- Raid mode activates
- Sampling rate increases to 40%
- Dashboard updates smoothly
- No memory leaks

✅ **Pass:** System handles high volume without degradation

### 9. Edge Cases Test

**Empty messages:**
- Server should ignore or handle gracefully

**Very long messages:**
- Should be stored and displayed correctly

**Special characters:**
- Unicode, emoji, special chars should work
- Example: `🎮 Test message with émojis and àccents`

**Rapid actions:**
- Click multiple action buttons quickly
- Should prevent duplicate actions

**Database corruption recovery:**
```bash
# Delete database
rm data/moderation.db

# Restart server
pnpm dev
```
Expected: Database recreates automatically

✅ **Pass:** Edge cases handled gracefully

## Load Testing

**Test with real Twitch channel:**
1. Connect to a large active channel (1000+ viewers)
2. Monitor for 30 minutes
3. Check:
   - Flags created vs false positives
   - Sampling efficiency
   - No crashes or memory leaks
   - Dashboard stays responsive

**Test database growth:**
```bash
# After 1 hour of testing
ls -lh data/moderation.db

# Query message count
sqlite3 data/moderation.db "SELECT COUNT(*) FROM messages;"

# Query flag count
sqlite3 data/moderation.db "SELECT COUNT(*) FROM flags;"
```

Expected: Reasonable database size (< 100MB for 1 hour in busy channel)

## Regression Testing

After making changes:

1. ✅ Connection still works
2. ✅ Sampling logic unchanged
3. ✅ Violations detected correctly
4. ✅ Dashboard updates in real-time
5. ✅ Actions execute properly
6. ✅ Database schema compatible
7. ✅ No new errors in logs

## Known Issues (Phase 1)

These are expected behaviors, not bugs:

- ⚠️ Actions are stubbed (no actual Twitch API calls)
- ⚠️ New user detection is heuristic (15min window, not actual account age)
- ⚠️ Rule-based engine has false positives/negatives
- ⚠️ No authentication on dashboard (runs locally)
- ⚠️ Single channel support only

## Test Results Template

```markdown
## Test Run: YYYY-MM-DD

**Environment:**
- Node version:
- pnpm version:
- OS:
- Channel tested:

**Results:**
- [ ] Connection Test
- [ ] Message Sampling Test
- [ ] Violation Detection Test
- [ ] Dashboard Functionality Test
- [ ] Action Handler Test
- [ ] WebSocket Reconnection Test
- [ ] API Endpoint Test
- [ ] Performance Test
- [ ] Edge Cases Test

**Issues Found:**
1.
2.

**Notes:**

```

## Automated Testing (Future)

Future improvements:
- Unit tests for moderation engine
- Integration tests for API endpoints
- E2E tests with Playwright
- CI/CD pipeline
- Test coverage reporting
