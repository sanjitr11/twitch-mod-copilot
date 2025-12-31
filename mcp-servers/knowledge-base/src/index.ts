#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import path from 'path';

/**
 * Knowledge Base MCP Server
 * Provides tools for querying similar violations and moderation policies
 */

interface SearchSimilarArgs {
  message_pattern: string;
  limit?: number;
  violation_type?: string;
}

interface GetPolicyArgs {
  violation_type: 'hate_speech' | 'harassment' | 'spam' | 'threats' | 'other';
}

class KnowledgeBaseServer {
  private server: Server;
  private db: Database.Database | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'knowledge-base-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();

    // Error handling
    this.server.onerror = (error) => {
      console.error('[MCP Knowledge Base] Error:', error);
    };

    process.on('SIGINT', async () => {
      this.closeDatabase();
      await this.server.close();
      process.exit(0);
    });
  }

  private connectDatabase() {
    if (this.db) return;

    // Connect to the main server's database
    const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), '../../apps/server/moderation.db');

    try {
      this.db = new Database(dbPath, { readonly: true });
      console.error(`[MCP Knowledge Base] Connected to database: ${dbPath}`);
    } catch (error) {
      console.error('[MCP Knowledge Base] Failed to connect to database:', error);
      this.db = null;
    }
  }

  private closeDatabase() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search_similar_violations',
            description:
              'Search for similar past violations to help with consistent moderation decisions. Returns previously flagged messages with similar patterns.',
            inputSchema: {
              type: 'object',
              properties: {
                message_pattern: {
                  type: 'string',
                  description: 'The message text to find similar violations for',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of similar violations to return (default: 5)',
                },
                violation_type: {
                  type: 'string',
                  description: 'Optional: Filter by violation type (hate_speech, harassment, spam, threats)',
                },
              },
              required: ['message_pattern'],
            },
          },
          {
            name: 'get_policy',
            description:
              'Get moderation policy guidelines for a specific violation type, including examples and recommended actions.',
            inputSchema: {
              type: 'object',
              properties: {
                violation_type: {
                  type: 'string',
                  enum: ['hate_speech', 'harassment', 'spam', 'threats', 'other'],
                  description: 'The type of violation to get policy for',
                },
              },
              required: ['violation_type'],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === 'search_similar_violations') {
          const result = await this.searchSimilarViolations(args as SearchSimilarArgs);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        if (name === 'get_policy') {
          const result = await this.getPolicy(args as GetPolicyArgs);
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

  private async searchSimilarViolations(args: SearchSimilarArgs): Promise<{
    violations: Array<{
      message: string;
      violation_type: string;
      confidence: number;
      reasoning: string;
      action_taken: string;
      similarity_score: number;
    }>;
  }> {
    const { message_pattern, limit = 5, violation_type } = args;

    console.error(
      `[MCP Knowledge Base] Searching for similar violations: "${message_pattern.substring(0, 50)}..." (limit: ${limit})`
    );

    this.connectDatabase();

    if (!this.db) {
      return { violations: [] };
    }

    try {
      // Use SQLite's built-in LIKE for simple similarity matching
      // For production, you'd want FTS5 or vector similarity
      let query = `
        SELECT
          message_text,
          violation_type,
          confidence,
          reasoning,
          status,
          timestamp
        FROM flags
        WHERE message_text LIKE ?
      `;

      const params: any[] = [`%${message_pattern}%`];

      if (violation_type) {
        query += ` AND violation_type = ?`;
        params.push(violation_type);
      }

      query += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit);

      const stmt = this.db.prepare(query);
      const rows = stmt.all(...params) as Array<{
        message_text: string;
        violation_type: string;
        confidence: number;
        reasoning: string;
        status: string;
        timestamp: number;
      }>;

      const violations = rows.map((row) => ({
        message: row.message_text,
        violation_type: row.violation_type,
        confidence: row.confidence,
        reasoning: row.reasoning,
        action_taken: row.status === 'actioned' ? 'action_taken' : 'dismissed',
        similarity_score: this.calculateSimilarity(message_pattern, row.message_text),
      }));

      console.error(`[MCP Knowledge Base] Found ${violations.length} similar violations`);

      return { violations };
    } catch (error) {
      console.error('[MCP Knowledge Base] Search failed:', error);
      return { violations: [] };
    }
  }

  private calculateSimilarity(str1: string, str2: string): number {
    // Simple word overlap similarity
    // For production, use Levenshtein distance or embedding similarity
    const words1 = new Set(str1.toLowerCase().split(/\s+/));
    const words2 = new Set(str2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  private async getPolicy(args: GetPolicyArgs): Promise<{
    violation_type: string;
    description: string;
    examples: string[];
    escalation_path: string[];
    default_action: string;
  }> {
    const { violation_type } = args;

    console.error(`[MCP Knowledge Base] Getting policy for: ${violation_type}`);

    // Hardcoded policies - in production, store these in a database
    const policies: Record<string, any> = {
      hate_speech: {
        violation_type: 'hate_speech',
        description:
          'Attacks or derogatory language targeting protected characteristics (race, ethnicity, religion, gender, sexual orientation, disability)',
        examples: [
          'Slurs or derogatory terms targeting protected groups',
          'Promotion of hate groups or ideologies',
          'Calls for violence or harm against protected groups',
        ],
        escalation_path: ['timeout_1h', 'timeout_24h', 'ban'],
        default_action: 'ban',
      },
      harassment: {
        violation_type: 'harassment',
        description:
          'Targeted abuse, threats, or unwanted contact directed at specific individuals',
        examples: [
          'Personal attacks or insults directed at another user',
          'Doxxing or sharing personal information',
          'Sexual harassment or unwanted advances',
          'Brigading or coordinated harassment',
        ],
        escalation_path: ['timeout_1h', 'timeout_24h', 'ban'],
        default_action: 'timeout_24h',
      },
      spam: {
        violation_type: 'spam',
        description:
          'Repetitive messages, excessive caps/emotes, promotional content, or off-topic flooding',
        examples: [
          'Repeated identical or similar messages',
          'Excessive use of caps lock or emotes',
          'Unsolicited promotional links',
          'ASCII art spam',
        ],
        escalation_path: ['timeout_1h', 'timeout_24h', 'ban'],
        default_action: 'timeout_1h',
      },
      threats: {
        violation_type: 'threats',
        description: 'Threats of violence, harm, or illegal activity',
        examples: [
          'Direct threats of physical violence',
          'Threats of swatting or doxxing',
          'Encouragement of self-harm',
          'Terrorism-related threats',
        ],
        escalation_path: ['ban'],
        default_action: 'ban',
      },
      other: {
        violation_type: 'other',
        description: 'Other policy violations not covered by specific categories',
        examples: ['Impersonation', 'Scams', 'Misinformation'],
        escalation_path: ['timeout_1h', 'timeout_24h', 'ban'],
        default_action: 'timeout_1h',
      },
    };

    const policy = policies[violation_type] || policies.other;
    return policy;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[MCP Knowledge Base] Server running on stdio');
  }
}

// Start the server
const server = new KnowledgeBaseServer();
server.run().catch((error) => {
  console.error('[MCP Knowledge Base] Fatal error:', error);
  process.exit(1);
});
