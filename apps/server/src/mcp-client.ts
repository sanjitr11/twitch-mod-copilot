import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * MCP Client for connecting to Twitch API MCP Server
 * Manages the lifecycle of the MCP server process and provides a clean interface for tool calls
 */
export class TwitchApiMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connected = false;

  async connect(): Promise<void> {
    if (this.connected) {
      console.log('[MCP Client] Already connected');
      return;
    }

    try {
      // Path to the MCP server
      const serverPath = path.resolve(__dirname, '../../../mcp-servers/twitch-api');
      const serverScript = path.join(serverPath, 'src/index.ts');

      console.log('[MCP Client] Starting Twitch API MCP server...');
      console.log('[MCP Client] Server path:', serverPath);

      // Spawn the MCP server process using tsx
      const serverProcess = spawn('npx', ['tsx', serverScript], {
        cwd: serverPath,
        env: {
          ...process.env,
          // Pass through Twitch credentials
          TWITCH_MOD_TOKEN: process.env.TWITCH_MOD_TOKEN,
          TWITCH_BROADCASTER_IDS: process.env.TWITCH_BROADCASTER_IDS,
          TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID,
          TWITCH_MOD_USER_ID: process.env.TWITCH_MOD_USER_ID,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Log server errors
      serverProcess.stderr.on('data', (data) => {
        console.log('[MCP Server]', data.toString().trim());
      });

      serverProcess.on('error', (error) => {
        console.error('[MCP Client] Server process error:', error);
      });

      serverProcess.on('exit', (code) => {
        console.log(`[MCP Client] Server process exited with code ${code}`);
        this.connected = false;
      });

      // Create transport using the spawned process
      this.transport = new StdioClientTransport({
        command: serverProcess,
      });

      // Create and connect client
      this.client = new Client(
        {
          name: 'twitch-moderation-server',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      await this.client.connect(this.transport);
      this.connected = true;

      console.log('[MCP Client] Connected to Twitch API MCP server');

      // List available tools
      const tools = await this.client.listTools();
      console.log(
        '[MCP Client] Available tools:',
        tools.tools.map((t) => t.name)
      );
    } catch (error) {
      console.error('[MCP Client] Failed to connect:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected || !this.client) {
      return;
    }

    try {
      await this.client.close();
      this.connected = false;
      console.log('[MCP Client] Disconnected from Twitch API MCP server');
    } catch (error) {
      console.error('[MCP Client] Error during disconnect:', error);
    }
  }

  async executeBan(
    channel: string,
    username: string,
    reason?: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.connected || !this.client) {
      throw new Error('MCP client not connected');
    }

    try {
      const result = await this.client.callTool({
        name: 'execute_ban',
        arguments: {
          channel,
          username,
          reason,
        },
      });

      // Parse the response
      if (result.content && result.content.length > 0) {
        const content = result.content[0];
        if (content.type === 'text') {
          return JSON.parse(content.text);
        }
      }

      throw new Error('Unexpected response format from MCP server');
    } catch (error) {
      console.error('[MCP Client] Execute ban failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async executeTimeout(
    channel: string,
    username: string,
    durationSeconds: number,
    reason?: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.connected || !this.client) {
      throw new Error('MCP client not connected');
    }

    try {
      const result = await this.client.callTool({
        name: 'execute_timeout',
        arguments: {
          channel,
          username,
          duration_seconds: durationSeconds,
          reason,
        },
      });

      // Parse the response
      if (result.content && result.content.length > 0) {
        const content = result.content[0];
        if (content.type === 'text') {
          return JSON.parse(content.text);
        }
      }

      throw new Error('Unexpected response format from MCP server');
    } catch (error) {
      console.error('[MCP Client] Execute timeout failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema: unknown }>> {
    if (!this.connected || !this.client) {
      return [];
    }
    const result = await this.client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async callToolDynamic(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string; data?: unknown }> {
    if (!this.connected || !this.client) {
      throw new Error('MCP client not connected');
    }
    const result = await this.client.callTool({ name, arguments: args });
    if (result.content && result.content.length > 0) {
      const content = result.content[0];
      if (content.type === 'text') {
        return JSON.parse(content.text);
      }
    }
    throw new Error('Unexpected response format from MCP server');
  }

  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * MCP Client for connecting to Knowledge Base MCP Server
 * Provides access to similar violation search and policy information
 */
export class KnowledgeBaseMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connected = false;

  async connect(): Promise<void> {
    if (this.connected) {
      console.log('[MCP KB Client] Already connected');
      return;
    }

    try {
      // Path to the MCP server
      const serverPath = path.resolve(__dirname, '../../../mcp-servers/knowledge-base');
      const serverScript = path.join(serverPath, 'src/index.ts');

      console.log('[MCP KB Client] Starting Knowledge Base MCP server...');
      console.log('[MCP KB Client] Server path:', serverPath);

      // Spawn the MCP server process using tsx
      const serverProcess = spawn('npx', ['tsx', serverScript], {
        cwd: serverPath,
        env: {
          ...process.env,
          // Pass database path
          DB_PATH: process.env.DB_PATH || path.resolve(__dirname, '../moderation.db'),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Log server errors
      serverProcess.stderr.on('data', (data) => {
        console.log('[MCP KB Server]', data.toString().trim());
      });

      serverProcess.on('error', (error) => {
        console.error('[MCP KB Client] Server process error:', error);
      });

      serverProcess.on('exit', (code) => {
        console.log(`[MCP KB Client] Server process exited with code ${code}`);
        this.connected = false;
      });

      // Create transport using the spawned process
      this.transport = new StdioClientTransport({
        command: serverProcess,
      });

      // Create and connect client
      this.client = new Client(
        {
          name: 'twitch-moderation-kb-client',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      await this.client.connect(this.transport);
      this.connected = true;

      console.log('[MCP KB Client] Connected to Knowledge Base MCP server');

      // List available tools
      const tools = await this.client.listTools();
      console.log(
        '[MCP KB Client] Available tools:',
        tools.tools.map((t) => t.name)
      );
    } catch (error) {
      console.error('[MCP KB Client] Failed to connect:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected || !this.client) {
      return;
    }

    try {
      await this.client.close();
      this.connected = false;
      console.log('[MCP KB Client] Disconnected from Knowledge Base MCP server');
    } catch (error) {
      console.error('[MCP KB Client] Error during disconnect:', error);
    }
  }

  async searchSimilarViolations(
    messagePattern: string,
    limit = 5,
    violationType?: string
  ): Promise<{
    violations: Array<{
      message: string;
      violation_type: string;
      confidence: number;
      reasoning: string;
      action_taken: string;
      similarity_score: number;
    }>;
  }> {
    if (!this.connected || !this.client) {
      console.warn('[MCP KB Client] Not connected, returning empty results');
      return { violations: [] };
    }

    try {
      const result = await this.client.callTool({
        name: 'search_similar_violations',
        arguments: {
          message_pattern: messagePattern,
          limit,
          violation_type: violationType,
        },
      });

      // Parse the response
      if (result.content && result.content.length > 0) {
        const content = result.content[0];
        if (content.type === 'text') {
          return JSON.parse(content.text);
        }
      }

      return { violations: [] };
    } catch (error) {
      console.error('[MCP KB Client] Search similar violations failed:', error);
      return { violations: [] };
    }
  }

  async getPolicy(violationType: string): Promise<{
    violation_type: string;
    description: string;
    examples: string[];
    escalation_path: string[];
    default_action: string;
  } | null> {
    if (!this.connected || !this.client) {
      console.warn('[MCP KB Client] Not connected, returning null');
      return null;
    }

    try {
      const result = await this.client.callTool({
        name: 'get_policy',
        arguments: {
          violation_type: violationType,
        },
      });

      // Parse the response
      if (result.content && result.content.length > 0) {
        const content = result.content[0];
        if (content.type === 'text') {
          return JSON.parse(content.text);
        }
      }

      return null;
    } catch (error) {
      console.error('[MCP KB Client] Get policy failed:', error);
      return null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
