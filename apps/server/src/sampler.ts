import { ChatMessage, SampledMessage } from './types';
import { DatabaseService } from './database';

export interface SamplingConfig {
  baseSamplingRate: number;
  raidSamplingRate: number;
  raidMsgsPerSec: number;
  newUserWindowMs: number;
}

export class MessageSampler {
  private config: SamplingConfig;
  private db: DatabaseService;
  private seenUsers: Map<string, number> = new Map(); // username -> first seen timestamp
  private messageTimestamps: number[] = [];
  private raidMode = false;

  constructor(config: SamplingConfig, db: DatabaseService) {
    this.config = config;
    this.db = db;

    // Clean old timestamps every 10 seconds
    setInterval(() => this.cleanOldTimestamps(), 10000);
  }

  shouldSample(message: ChatMessage): { sample: boolean; reason: string } {
    const now = Date.now();

    // Track message for velocity calculation
    this.messageTimestamps.push(now);

    // Update raid mode
    this.updateRaidMode();

    // Always sample new users (not seen in last X minutes)
    if (!this.seenUsers.has(message.username)) {
      this.seenUsers.set(message.username, now);
      return { sample: true, reason: 'new_user' };
    }

    const firstSeen = this.seenUsers.get(message.username)!;
    if (now - firstSeen < this.config.newUserWindowMs) {
      return { sample: true, reason: 'recent_new_user' };
    }

    // Always sample users with prior flags
    const history = this.db.getUserHistory(message.channel, message.username);
    if (history && history.total_flags > 0) {
      return { sample: true, reason: 'prior_flags' };
    }

    // Sample based on current rate (raid mode or normal)
    const currentRate = this.raidMode ? this.config.raidSamplingRate : this.config.baseSamplingRate;
    const shouldSample = Math.random() < currentRate;

    return {
      sample: shouldSample,
      reason: shouldSample ? (this.raidMode ? 'raid_mode_sample' : 'base_sample') : 'not_sampled',
    };
  }

  private updateRaidMode() {
    const now = Date.now();
    const oneSecondAgo = now - 1000;

    const recentCount = this.messageTimestamps.filter((ts) => ts >= oneSecondAgo).length;
    const wasRaidMode = this.raidMode;

    this.raidMode = recentCount >= this.config.raidMsgsPerSec;

    if (this.raidMode && !wasRaidMode) {
      console.log(`[Sampler] Raid mode activated (${recentCount} msgs/sec)`);
    } else if (!this.raidMode && wasRaidMode) {
      console.log(`[Sampler] Raid mode deactivated`);
    }
  }

  private cleanOldTimestamps() {
    const cutoff = Date.now() - 5000; // Keep last 5 seconds
    this.messageTimestamps = this.messageTimestamps.filter((ts) => ts >= cutoff);

    // Clean old user tracking (keep last 15 minutes)
    const userCutoff = Date.now() - this.config.newUserWindowMs;
    for (const [username, timestamp] of this.seenUsers.entries()) {
      if (timestamp < userCutoff) {
        this.seenUsers.delete(username);
      }
    }
  }

  isRaidMode(): boolean {
    return this.raidMode;
  }

  getCurrentRate(): number {
    return this.raidMode ? this.config.raidSamplingRate : this.config.baseSamplingRate;
  }
}
