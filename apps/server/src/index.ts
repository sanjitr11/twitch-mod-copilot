import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { DatabaseService } from './database';
import { TwitchClient } from './twitch-client';
import { MessageSampler } from './sampler';
import { HybridModerationEngine } from './moderation-engine';
import { MessageProcessor } from './message-processor';
import { WebSocketServer } from './websocket';
import { ActionHandler } from './action-handler';
import { createApiRouter } from './api';
import { TwitchApiMcpClient, KnowledgeBaseMcpClient } from './mcp-client';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3001');
const DATABASE_PATH = process.env.DATABASE_PATH || './data/moderation.db';

const TWITCH_BOT_USERNAME = process.env.TWITCH_BOT_USERNAME;
const TWITCH_OAUTH_TOKEN = process.env.TWITCH_OAUTH_TOKEN;
const TWITCH_CHANNEL = process.env.TWITCH_CHANNEL;

const BASE_SAMPLING_RATE = parseFloat(process.env.BASE_SAMPLING_RATE || '0.10');
const RAID_SAMPLING_RATE = parseFloat(process.env.RAID_SAMPLING_RATE || '0.40');
const RAID_MSGS_PER_SEC = parseInt(process.env.RAID_MSGS_PER_SEC || '10');

async function main() {
  console.log('[Server] Starting Twitch Moderation Co-Pilot...');

  // Validate required environment variables
  if (!TWITCH_BOT_USERNAME || !TWITCH_OAUTH_TOKEN || !TWITCH_CHANNEL) {
    console.error('[Server] Missing required environment variables:');
    console.error('  TWITCH_BOT_USERNAME:', TWITCH_BOT_USERNAME ? '✓' : '✗');
    console.error('  TWITCH_OAUTH_TOKEN:', TWITCH_OAUTH_TOKEN ? '✓' : '✗');
    console.error('  TWITCH_CHANNEL:', TWITCH_CHANNEL ? '✓' : '✗');
    console.error('\nPlease check your .env file and ensure all required variables are set.');
    process.exit(1);
  }

  // Initialize database
  console.log('[Server] Initializing database...');
  const db = new DatabaseService(DATABASE_PATH);

  // Initialize MCP client for Twitch API
  console.log('[Server] Connecting to Twitch API MCP server...');
  const mcpClient = new TwitchApiMcpClient();
  await mcpClient.connect();

  // Initialize MCP client for Knowledge Base
  console.log('[Server] Connecting to Knowledge Base MCP server...');
  const kbClient = new KnowledgeBaseMcpClient();
  await kbClient.connect();

  // Initialize sampler
  const sampler = new MessageSampler(
    {
      baseSamplingRate: BASE_SAMPLING_RATE,
      raidSamplingRate: RAID_SAMPLING_RATE,
      raidMsgsPerSec: RAID_MSGS_PER_SEC,
      newUserWindowMs: 15 * 60 * 1000, // 15 minutes
    },
    db
  );

  // Initialize moderation engine (Hybrid: strict rules + LLM + Knowledge Base)
  const moderationEngine = new HybridModerationEngine(kbClient);

  // Initialize Express app and WebSocket
  const app = express();
  const server = createServer(app);
  const wsServer = new WebSocketServer(server);

  // Initialize message processor
  const processor = new MessageProcessor(db, sampler, moderationEngine, wsServer);

  // Initialize action handler with MCP client
  const actionHandler = new ActionHandler(db, mcpClient);

  // Configure Express
  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      channel: TWITCH_CHANNEL,
      raidMode: sampler.isRaidMode(),
      samplingRate: sampler.getCurrentRate(),
    });
  });

  // API routes
  app.use('/api', createApiRouter(db, actionHandler));

  // Start HTTP server
  server.listen(PORT, () => {
    console.log(`[Server] HTTP server listening on port ${PORT}`);
    console.log(`[Server] WebSocket available at ws://localhost:${PORT}/ws`);
  });

  // Initialize Twitch client
  console.log(`[Server] Connecting to Twitch channel: ${TWITCH_CHANNEL}`);
  const twitchClient = new TwitchClient(TWITCH_BOT_USERNAME, TWITCH_OAUTH_TOKEN, TWITCH_CHANNEL);

  twitchClient.onMessage((message) => {
    processor.processMessage(message);
  });

  await twitchClient.connect();

  console.log('[Server] All systems operational');
  console.log(`[Server] Sampling rate: ${BASE_SAMPLING_RATE} (base) / ${RAID_SAMPLING_RATE} (raid)`);
  console.log(`[Server] Raid threshold: ${RAID_MSGS_PER_SEC} msgs/sec`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[Server] Shutting down...');

    await processor.shutdown();
    await twitchClient.disconnect();
    await mcpClient.disconnect();
    await kbClient.disconnect();
    db.close();

    server.close(() => {
      console.log('[Server] Server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[Server] Fatal error:', error);
  process.exit(1);
});
