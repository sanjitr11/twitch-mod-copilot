import tmi from 'tmi.js';
import { ChatMessage } from './types';
import { createHash } from 'crypto';

export class TwitchClient {
  private client: tmi.Client;
  private messageHandlers: Array<(message: ChatMessage) => void> = [];
  private channel: string;

  constructor(username: string, oauthToken: string, channel: string) {
    this.channel = channel.toLowerCase();

    this.client = new tmi.Client({
      options: { debug: false },
      identity: {
        username,
        password: oauthToken,
      },
      channels: [this.channel],
    });

    this.setupHandlers();
  }

  private setupHandlers() {
    this.client.on('message', (channel, tags, message, self) => {
      if (self) return; // Ignore own messages

      const chatMessage: ChatMessage = {
        id: this.generateMessageId(channel, tags.username || 'unknown', message, Date.now()),
        channel: channel.replace('#', ''),
        username: tags.username || 'unknown',
        message_text: message,
        received_at: Date.now(),
        user_id: tags['user-id'],
        tags: tags as Record<string, string>,
      };

      this.messageHandlers.forEach((handler) => handler(chatMessage));
    });

    this.client.on('connected', (address, port) => {
      console.log(`[Twitch] Connected to ${address}:${port}`);
    });

    this.client.on('disconnected', (reason) => {
      console.log(`[Twitch] Disconnected: ${reason}`);
    });
  }

  private generateMessageId(
    channel: string,
    username: string,
    text: string,
    timestamp: number
  ): string {
    // Round timestamp to second to prevent duplicate flags for same message
    const roundedTimestamp = Math.floor(timestamp / 1000);
    const hash = createHash('md5')
      .update(`${channel}:${username}:${text}:${roundedTimestamp}`)
      .digest('hex');
    return hash;
  }

  onMessage(handler: (message: ChatMessage) => void) {
    this.messageHandlers.push(handler);
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  getChannel(): string {
    return this.channel;
  }
}
