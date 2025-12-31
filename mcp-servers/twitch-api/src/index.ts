#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Twitch API MCP Server
 * Provides tools for executing moderation actions via Twitch Helix API
 */

interface BanUserArgs {
  channel: string;
  username: string;
  reason?: string;
}

interface TimeoutUserArgs {
  channel: string;
  username: string;
  duration_seconds: number;
  reason?: string;
}

class TwitchApiServer {
  private server: Server;
  private modToken: string | undefined;
  private broadcasterIds: Map<string, string>;

  constructor() {
    this.server = new Server(
      {
        name: 'twitch-api-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Get configuration from environment
    this.modToken = process.env.TWITCH_MOD_TOKEN;
    this.broadcasterIds = new Map();

    // Parse broadcaster IDs from env (format: CHANNEL1:ID1,CHANNEL2:ID2)
    const broadcasterIdsEnv = process.env.TWITCH_BROADCASTER_IDS || '';
    if (broadcasterIdsEnv) {
      broadcasterIdsEnv.split(',').forEach((pair) => {
        const [channel, id] = pair.split(':');
        if (channel && id) {
          this.broadcasterIds.set(channel.toLowerCase(), id);
        }
      });
    }

    this.setupHandlers();

    // Error handling
    this.server.onerror = (error) => {
      console.error('[MCP Twitch API] Error:', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'execute_ban',
            description:
              'Ban a user from a Twitch channel. This is a permanent action that removes the user from chat and prevents them from rejoining.',
            inputSchema: {
              type: 'object',
              properties: {
                channel: {
                  type: 'string',
                  description: 'The Twitch channel name (e.g., "joe_bartolozzi")',
                },
                username: {
                  type: 'string',
                  description: 'The username of the user to ban',
                },
                reason: {
                  type: 'string',
                  description: 'Optional reason for the ban (for logging purposes)',
                },
              },
              required: ['channel', 'username'],
            },
          },
          {
            name: 'execute_timeout',
            description:
              'Timeout a user from a Twitch channel for a specified duration. The user will be temporarily unable to send messages.',
            inputSchema: {
              type: 'object',
              properties: {
                channel: {
                  type: 'string',
                  description: 'The Twitch channel name (e.g., "joe_bartolozzi")',
                },
                username: {
                  type: 'string',
                  description: 'The username of the user to timeout',
                },
                duration_seconds: {
                  type: 'number',
                  description: 'Duration of the timeout in seconds (e.g., 3600 for 1 hour)',
                },
                reason: {
                  type: 'string',
                  description: 'Optional reason for the timeout (for logging purposes)',
                },
              },
              required: ['channel', 'username', 'duration_seconds'],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === 'execute_ban') {
          const result = await this.executeBan(args as BanUserArgs);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        if (name === 'execute_timeout') {
          const result = await this.executeTimeout(args as TimeoutUserArgs);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async executeBan(args: BanUserArgs): Promise<{ success: boolean; error?: string }> {
    const { channel, username, reason } = args;

    console.error(
      `[MCP Twitch API] Ban request: ${username} in ${channel}` + (reason ? ` - ${reason}` : '')
    );

    // Check if we have mod token
    if (!this.modToken) {
      console.error(
        `[MCP Twitch API] SIMULATED BAN (no token): ${username} in ${channel}` +
          (reason ? ` - ${reason}` : '')
      );
      return {
        success: true,
        error: undefined,
      };
    }

    // Get broadcaster ID
    const broadcaster_id = this.broadcasterIds.get(channel.toLowerCase());
    if (!broadcaster_id) {
      return {
        success: false,
        error: `No broadcaster ID configured for channel: ${channel}`,
      };
    }

    try {
      // First, get the user ID from username
      const userResponse = await fetch(
        `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`,
        {
          headers: {
            'Authorization': `Bearer ${this.modToken}`,
            'Client-Id': process.env.TWITCH_CLIENT_ID || '',
          },
        }
      );

      if (!userResponse.ok) {
        throw new Error(`Failed to fetch user info: ${userResponse.statusText}`);
      }

      const userData = await userResponse.json();
      if (!userData.data || userData.data.length === 0) {
        return {
          success: false,
          error: `User not found: ${username}`,
        };
      }

      const userId = userData.data[0].id;

      // Execute ban via Twitch API
      const banResponse = await fetch(
        `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcaster_id}&moderator_id=${process.env.TWITCH_MOD_USER_ID}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.modToken}`,
            'Client-Id': process.env.TWITCH_CLIENT_ID || '',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            data: {
              user_id: userId,
              reason: reason || 'Violation of community guidelines',
            },
          }),
        }
      );

      if (!banResponse.ok) {
        const errorText = await banResponse.text();
        throw new Error(`Twitch API error: ${banResponse.statusText} - ${errorText}`);
      }

      console.error(`[MCP Twitch API] Successfully banned ${username} in ${channel}`);
      return {
        success: true,
      };
    } catch (error) {
      console.error(`[MCP Twitch API] Ban failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeTimeout(
    args: TimeoutUserArgs
  ): Promise<{ success: boolean; error?: string }> {
    const { channel, username, duration_seconds, reason } = args;

    console.error(
      `[MCP Twitch API] Timeout request: ${username} in ${channel} for ${duration_seconds}s` +
        (reason ? ` - ${reason}` : '')
    );

    // Check if we have mod token
    if (!this.modToken) {
      console.error(
        `[MCP Twitch API] SIMULATED TIMEOUT (no token): ${username} in ${channel} for ${duration_seconds}s` +
          (reason ? ` - ${reason}` : '')
      );
      return {
        success: true,
        error: undefined,
      };
    }

    // Get broadcaster ID
    const broadcaster_id = this.broadcasterIds.get(channel.toLowerCase());
    if (!broadcaster_id) {
      return {
        success: false,
        error: `No broadcaster ID configured for channel: ${channel}`,
      };
    }

    try {
      // First, get the user ID from username
      const userResponse = await fetch(
        `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`,
        {
          headers: {
            'Authorization': `Bearer ${this.modToken}`,
            'Client-Id': process.env.TWITCH_CLIENT_ID || '',
          },
        }
      );

      if (!userResponse.ok) {
        throw new Error(`Failed to fetch user info: ${userResponse.statusText}`);
      }

      const userData = await userResponse.json();
      if (!userData.data || userData.data.length === 0) {
        return {
          success: false,
          error: `User not found: ${username}`,
        };
      }

      const userId = userData.data[0].id;

      // Execute timeout via Twitch API
      const timeoutResponse = await fetch(
        `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcaster_id}&moderator_id=${process.env.TWITCH_MOD_USER_ID}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.modToken}`,
            'Client-Id': process.env.TWITCH_CLIENT_ID || '',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            data: {
              user_id: userId,
              duration: duration_seconds,
              reason: reason || 'Violation of community guidelines',
            },
          }),
        }
      );

      if (!timeoutResponse.ok) {
        const errorText = await timeoutResponse.text();
        throw new Error(`Twitch API error: ${timeoutResponse.statusText} - ${errorText}`);
      }

      console.error(
        `[MCP Twitch API] Successfully timed out ${username} in ${channel} for ${duration_seconds}s`
      );
      return {
        success: true,
      };
    } catch (error) {
      console.error(`[MCP Twitch API] Timeout failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[MCP Twitch API] Server running on stdio');
  }
}

// Start the server
const server = new TwitchApiServer();
server.run().catch((error) => {
  console.error('[MCP Twitch API] Fatal error:', error);
  process.exit(1);
});
