import { DatabaseService } from './database';
import { TwitchApiMcpClient } from './mcp-client';

export type ActionType = 'timeout_1h' | 'timeout_24h' | 'ban';

export class ActionHandler {
  private db: DatabaseService;
  private mcpClient: TwitchApiMcpClient;

  constructor(db: DatabaseService, mcpClient: TwitchApiMcpClient) {
    this.db = db;
    this.mcpClient = mcpClient;
  }

  async executeAction(
    flagId: number,
    action: ActionType,
    username: string,
    channel: string
  ): Promise<void> {
    console.log(`[Action] Executing ${action} on user ${username} in ${channel}`);

    // Update flag status
    this.db.updateFlagStatus(flagId, 'actioned', Date.now());

    // Update user history
    this.db.incrementUserActions(channel, username);

    // Execute action via MCP client
    await this.executeTwitchAction(action, username, channel);
  }

  private async executeTwitchAction(
    action: ActionType,
    username: string,
    channel: string
  ): Promise<void> {
    if (!this.mcpClient.isConnected()) {
      console.log(`[Action] MCP client not connected, action will be simulated`);
    }

    try {
      let result: { success: boolean; error?: string };

      if (action === 'ban') {
        result = await this.mcpClient.executeBan(
          channel,
          username,
          'Violation of community guidelines'
        );
      } else {
        // Timeout actions
        const duration = action === 'timeout_1h' ? 3600 : 86400; // 1h or 24h
        result = await this.mcpClient.executeTimeout(
          channel,
          username,
          duration,
          'Violation of community guidelines'
        );
      }

      if (result.success) {
        console.log(`[Action] Successfully executed ${action} on ${username} in ${channel}`);
      } else {
        console.error(
          `[Action] Failed to execute ${action} on ${username}:`,
          result.error
        );
      }
    } catch (error) {
      console.error(`[Action] Error executing ${action} on ${username}:`, error);
    }
  }
}
