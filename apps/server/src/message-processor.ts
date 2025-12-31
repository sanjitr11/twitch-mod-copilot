import { ChatMessage, SampledMessage, Flag, IModerationEngine } from './types';
import { DatabaseService } from './database';
import { MessageSampler } from './sampler';
import { WebSocketServer } from './websocket';

export class MessageProcessor {
  private db: DatabaseService;
  private sampler: MessageSampler;
  private engine: IModerationEngine;
  private ws: WebSocketServer;

  private messageQueue: SampledMessage[] = [];
  private contextBuffer: Map<string, ChatMessage[]> = new Map(); // channel -> last 10 messages
  private batchTimer?: NodeJS.Timeout;

  private readonly BATCH_SIZE = 10;
  private readonly BATCH_TIMEOUT_MS = 2000;
  private readonly CONTEXT_BUFFER_SIZE = 10;

  constructor(
    db: DatabaseService,
    sampler: MessageSampler,
    engine: IModerationEngine,
    ws: WebSocketServer
  ) {
    this.db = db;
    this.sampler = sampler;
    this.engine = engine;
    this.ws = ws;
  }

  async processMessage(message: ChatMessage): Promise<void> {
    // Add to context buffer
    this.addToContext(message);

    // Check if we should sample
    const { sample, reason } = this.sampler.shouldSample(message);

    if (!sample) return;

    // Check for duplicate
    if (this.db.hasRecentFlag(message.id)) {
      return;
    }

    const sampledMessage: SampledMessage = {
      ...message,
      sampled_reason: reason,
    };

    // Add to queue
    this.messageQueue.push(sampledMessage);

    // Broadcast system status
    this.broadcastSystemStatus();

    // Process batch if threshold reached
    if (this.messageQueue.length >= this.BATCH_SIZE) {
      await this.processBatch();
    } else {
      // Set timer for batch processing
      this.resetBatchTimer();
    }
  }

  private addToContext(message: ChatMessage) {
    const channel = message.channel;

    if (!this.contextBuffer.has(channel)) {
      this.contextBuffer.set(channel, []);
    }

    const buffer = this.contextBuffer.get(channel)!;
    buffer.push(message);

    // Keep only last N messages
    if (buffer.length > this.CONTEXT_BUFFER_SIZE) {
      buffer.shift();
    }
  }

  private resetBatchTimer() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.processBatch();
    }, this.BATCH_TIMEOUT_MS);
  }

  private async processBatch(): Promise<void> {
    if (this.messageQueue.length === 0) return;

    const batch = [...this.messageQueue];
    this.messageQueue = [];

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }

    console.log(`[Processor] Processing batch of ${batch.length} messages`);

    for (const message of batch) {
      await this.classifyAndStore(message);
    }

    this.broadcastSystemStatus();
  }

  private async classifyAndStore(message: SampledMessage): Promise<void> {
    // Get context for this channel
    const context = this.contextBuffer.get(message.channel) || [];

    // Classify message
    const result = await this.engine.classify(message, context);

    // Store message
    this.db.insertMessage(message);

    // If violation detected, create flag
    if (result.violation_type !== 'none' && result.confidence >= 0.6) {
      const flag: Flag = {
        message_id: message.id,
        violation_type: result.violation_type,
        confidence: result.confidence,
        reasoning: result.reasoning,
        recommended_action: result.recommended_action,
        status: 'pending',
        created_at: Date.now(),
      };

      const flagId = this.db.insertFlag(flag);
      flag.id = flagId;

      // Update user history
      this.db.incrementUserFlags(message.channel, message.username, message.received_at);

      // Broadcast flag to dashboard
      this.ws.broadcastFlagCreated({
        flag,
        message,
        context: context.slice(-5), // Last 5 messages as context
      });

      console.log(
        `[Processor] Flag created: ${message.username} - ${result.violation_type} (${result.confidence.toFixed(2)})`
      );
    }
  }

  private broadcastSystemStatus() {
    this.ws.broadcastSystemStatus({
      queueDepth: this.messageQueue.length,
      samplingRate: this.sampler.getCurrentRate(),
      raidMode: this.sampler.isRaidMode(),
    });
  }

  async shutdown(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // Process remaining messages
    if (this.messageQueue.length > 0) {
      await this.processBatch();
    }
  }
}
