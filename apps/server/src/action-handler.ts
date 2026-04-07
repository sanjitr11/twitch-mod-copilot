import { DatabaseService } from './database';
import { TwitchApiMcpClient } from './mcp-client';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

// Synthetic tool injected at the 0.6–0.7 confidence tier.
// It does not exist on the MCP server — ActionHandler handles it locally.
const ESCALATE_TO_HUMAN_TOOL = {
  name: 'escalate_to_human',
  description:
    'Mark this case for human review. Use when confidence is insufficient for automated action.',
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Why this case needs human review' },
    },
    required: ['reason'],
  },
};

type ToolDefinition = { name: string; description?: string; inputSchema: unknown };
type ToolChoice = { tool: string; arguments: Record<string, unknown> };

export class ActionHandler {
  private db: DatabaseService;
  private mcpClient: TwitchApiMcpClient;

  constructor(db: DatabaseService, mcpClient: TwitchApiMcpClient) {
    this.db = db;
    this.mcpClient = mcpClient;
  }

  async executeAction(flagId: number, username: string, channel: string): Promise<void> {
    console.log(`[Action] Resolving action for flag ${flagId} — ${username} in ${channel}`);

    const flag = this.db.getFlagWithMessage(flagId);
    if (!flag) {
      console.error(`[Action] Flag ${flagId} not found`);
      return;
    }

    const { confidence, violation_type, reasoning, recommended_action, message_text } = flag;

    // --- Confidence gating ---
    if (confidence < 0.6) {
      console.log(
        `[Action] Confidence ${confidence} below 0.6 threshold — no automated action taken`
      );
      return;
    }

    let availableTools: ToolDefinition[];

    if (confidence >= 0.7) {
      // Full tool set: read dynamically from MCP server, no hardcoded names
      availableTools = await this.mcpClient.listTools();
      if (availableTools.length === 0) {
        console.warn('[Action] MCP server returned no tools');
        return;
      }
    } else {
      // 0.6 ≤ confidence < 0.7: only offer escalation
      availableTools = [ESCALATE_TO_HUMAN_TOOL];
    }

    // --- LLM tool selection ---
    const choice = await this.selectToolWithLLM({
      username,
      channel,
      messageText: message_text,
      violationType: violation_type,
      confidence,
      reasoning,
      recommendedAction: recommended_action,
      availableTools,
    });

    if (!choice) {
      console.error('[Action] LLM did not return a valid tool choice — no action taken');
      return;
    }

    const { tool, arguments: toolArgs } = choice;

    // Escalation is handled locally — the flag stays pending for a human to review
    if (tool === 'escalate_to_human') {
      console.log(
        `[Action] LLM escalated flag ${flagId} to human review: ${toolArgs.reason ?? '(no reason)'}`
      );
      return;
    }

    // Update DB, then route directly to MCP — no switch, no hardcoded tool names
    this.db.updateFlagStatus(flagId, 'actioned', Date.now());
    this.db.incrementUserActions(channel, username);

    try {
      const result = await this.mcpClient.callToolDynamic(tool, toolArgs);
      if ((result as { success?: boolean }).success) {
        console.log(`[Action] Tool "${tool}" succeeded on ${username} in ${channel}`);
      } else {
        console.error(`[Action] Tool "${tool}" reported failure:`, result);
      }
    } catch (error) {
      console.error(`[Action] Tool "${tool}" threw:`, error);
    }
  }

  private async selectToolWithLLM(params: {
    username: string;
    channel: string;
    messageText: string;
    violationType: string;
    confidence: number;
    reasoning: string;
    recommendedAction: string;
    availableTools: ToolDefinition[];
  }): Promise<ToolChoice | null> {
    const {
      username,
      channel,
      messageText,
      violationType,
      confidence,
      reasoning,
      recommendedAction,
      availableTools,
    } = params;

    const toolsJson = JSON.stringify(
      availableTools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      })),
      null,
      2
    );

    const prompt = `You are a Twitch moderation system. A human reviewer has approved action on a flagged message.
Select the correct tool and provide its arguments.

VIOLATION CONTEXT:
- Username: ${username}
- Channel: ${channel}
- Message: "${messageText}"
- Violation type: ${violationType}
- Confidence: ${confidence}
- Analysis: ${reasoning}
- Original recommendation: ${recommendedAction}

AVAILABLE TOOLS:
${toolsJson}

Rules:
- For execute_timeout, use duration_seconds 3600 for a 1-hour timeout and 86400 for a 24-hour timeout.
- Match the original recommendation unless the violation type clearly calls for a different action.
- Always include a brief reason string when a reason field is available.

Respond ONLY with valid JSON — no other text:
{
  "tool": "<tool_name>",
  "arguments": { ... }
}`;

    try {
      const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          stream: false,
          format: 'json',
          options: { temperature: 0.1, num_predict: 200 },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.statusText}`);
      }

      const data = await response.json();
      const result = JSON.parse(data.response);

      if (typeof result.tool !== 'string' || typeof result.arguments !== 'object') {
        console.error('[Action] LLM response malformed:', result);
        return null;
      }

      // Reject any tool name the LLM invented that we did not offer
      const validNames = availableTools.map((t) => t.name);
      if (!validNames.includes(result.tool)) {
        console.error(
          `[Action] LLM selected tool "${result.tool}" which was not in the offered set:`,
          validNames
        );
        return null;
      }

      console.log(`[Action] LLM selected tool "${result.tool}" with args:`, result.arguments);
      return { tool: result.tool, arguments: result.arguments as Record<string, unknown> };
    } catch (error) {
      console.error('[Action] LLM tool selection failed:', error);
      return null;
    }
  }
}
