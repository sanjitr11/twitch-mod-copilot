import { ChatMessage, ModerationResult, IModerationEngine, ViolationType } from './types';
import { KnowledgeBaseMcpClient } from './mcp-client';

/**
 * Phase 1: Rule-based moderation engine
 * This is a pluggable interface that can be swapped with an LLM later
 */
export class RuleBasedModerationEngine implements IModerationEngine {
  private hateSpeechPatterns = [
    /\b(n[i1]gg[ae]r|f[a4]gg[o0]t|k[i1]ke|ch[i1]nk|sp[i1]c)\b/i,
    /\b(ret[a4]rd|tr[a4]nny)\b/i,
    /\bk[iy]ll\s+yourself\b/i,
  ];

  private harassmentPatterns = [
    /\bstupid\s+(bitch|whore|slut)\b/i,
    /\byou\s+should\s+(die|kill yourself)\b/i,
    /\b(doxx|dox|swat)\s+(him|her|them)\b/i,
    /\bget\s+cancer\b/i,
  ];

  private sexualContentPatterns = [
    /\b(porn|xxx|sex|nude|dick|pussy|cock)\s+(link|url|\.com)\b/i,
    /\bonlyfans\.com/i,
    /\b(send|show)\s+(nudes|tits|ass)\b/i,
  ];

  private spamPatterns = [
    /(.)\1{10,}/, // Character repetition
    /\b(free|win|claim|click)\s+(here|now|link)\b/i,
    /\b(bit\.ly|tinyurl|goo\.gl)\//i,
  ];

  async classify(message: ChatMessage, context: ChatMessage[]): Promise<ModerationResult> {
    const text = message.message_text;

    // Check for coordinated attack (multiple similar messages in context)
    const coordinated = this.detectCoordinatedAttack(message, context);
    if (coordinated) {
      return {
        violation_type: 'coordinated_attack',
        confidence: 0.85,
        reasoning: 'Multiple users posting similar messages in short timeframe',
        recommended_action: 'timeout_1h',
      };
    }

    // Check hate speech
    for (const pattern of this.hateSpeechPatterns) {
      if (pattern.test(text)) {
        return {
          violation_type: 'hate_speech',
          confidence: 0.95,
          reasoning: 'Contains hate speech or slurs',
          recommended_action: 'ban',
        };
      }
    }

    // Check harassment
    for (const pattern of this.harassmentPatterns) {
      if (pattern.test(text)) {
        return {
          violation_type: 'harassment',
          confidence: 0.9,
          reasoning: 'Contains threatening or harassing language',
          recommended_action: 'timeout_24h',
        };
      }
    }

    // Check sexual content
    for (const pattern of this.sexualContentPatterns) {
      if (pattern.test(text)) {
        return {
          violation_type: 'sexual_content',
          confidence: 0.85,
          reasoning: 'Contains sexual content or solicitation',
          recommended_action: 'timeout_1h',
        };
      }
    }

    // Check spam
    for (const pattern of this.spamPatterns) {
      if (pattern.test(text)) {
        return {
          violation_type: 'spam',
          confidence: 0.8,
          reasoning: 'Appears to be spam or excessive repetition',
          recommended_action: 'timeout_1h',
        };
      }
    }

    // Check for ALL CAPS (potential spam/shouting)
    if (text.length > 20 && text === text.toUpperCase() && /[A-Z]/.test(text)) {
      return {
        violation_type: 'spam',
        confidence: 0.6,
        reasoning: 'Excessive use of capital letters',
        recommended_action: 'flag',
      };
    }

    return {
      violation_type: 'none',
      confidence: 0.0,
      reasoning: 'No violations detected',
      recommended_action: 'none',
    };
  }

  private detectCoordinatedAttack(message: ChatMessage, context: ChatMessage[]): boolean {
    if (context.length < 3) return false;

    // Look for similar messages from different users in last 30 seconds
    const recentWindow = message.received_at - 30000;
    const recentMessages = context.filter((m) => m.received_at >= recentWindow);

    if (recentMessages.length < 3) return false;

    // Simple similarity: check if 3+ messages share significant word overlap
    const words = this.getSignificantWords(message.message_text);
    if (words.length < 2) return false;

    let similarCount = 0;
    const seenUsers = new Set<string>();

    for (const ctx of recentMessages) {
      if (ctx.username === message.username) continue;
      if (seenUsers.has(ctx.username)) continue;

      const ctxWords = this.getSignificantWords(ctx.message_text);
      const overlap = words.filter((w) => ctxWords.includes(w)).length;

      if (overlap >= Math.min(2, words.length * 0.5)) {
        similarCount++;
        seenUsers.add(ctx.username);
      }
    }

    return similarCount >= 2;
  }

  private getSignificantWords(text: string): string[] {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were']);
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w));
  }
}

/**
 * Hybrid moderation engine: Strict rules for clear violations + LLM for context-dependent cases
 */
export class HybridModerationEngine implements IModerationEngine {
  private ollamaUrl = 'http://localhost:11434';
  private modelName = 'llama3.1:8b';
  private kbClient: KnowledgeBaseMcpClient | null = null;

  constructor(kbClient?: KnowledgeBaseMcpClient) {
    this.kbClient = kbClient || null;
  }

  // Strict rules for clear-cut violations (keep these regex-based)
  private hateSpeechPatterns = [
    /\b(n[i1]gg[ae]r|f[a4]gg[o0]t|k[i1]ke|ch[i1]nk|sp[i1]c)\b/i,
    /\b(ret[a4]rd|tr[a4]nny)\b/i,
  ];

  private threatPatterns = [
    /\bk[iy]ll\s+yourself\b/i,
    /\byou\s+should\s+(die|kill yourself)\b/i,
    /\bget\s+cancer\b/i,
  ];

  private doxxingPatterns = [
    /\b(doxx|dox|swat)\s+(him|her|them)\b/i,
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // Phone numbers
  ];

  private scamSpamPatterns = [
    /\b(bit\.ly|tinyurl|goo\.gl)\//i,
    /\b(free|win|claim)\s+(money|bitcoin|crypto|gift)/i,
  ];

  async classify(message: ChatMessage, context: ChatMessage[]): Promise<ModerationResult> {
    const text = message.message_text;

    // STRICT RULES FIRST (regex-based, high confidence)

    // 1. Hate speech - BAN immediately
    for (const pattern of this.hateSpeechPatterns) {
      if (pattern.test(text)) {
        return {
          violation_type: 'hate_speech',
          confidence: 0.98,
          reasoning: 'Contains hate speech or slurs (rule-based)',
          recommended_action: 'ban',
        };
      }
    }

    // 2. Threats of violence - BAN
    for (const pattern of this.threatPatterns) {
      if (pattern.test(text)) {
        return {
          violation_type: 'harassment',
          confidence: 0.95,
          reasoning: 'Contains threats of violence (rule-based)',
          recommended_action: 'ban',
        };
      }
    }

    // 3. Doxxing - BAN
    for (const pattern of this.doxxingPatterns) {
      if (pattern.test(text)) {
        return {
          violation_type: 'harassment',
          confidence: 0.95,
          reasoning: 'Potential doxxing attempt (rule-based)',
          recommended_action: 'ban',
        };
      }
    }

    // 4. Scam/phishing spam - TIMEOUT
    for (const pattern of this.scamSpamPatterns) {
      if (pattern.test(text)) {
        return {
          violation_type: 'spam',
          confidence: 0.9,
          reasoning: 'Scam or phishing link detected (rule-based)',
          recommended_action: 'timeout_24h',
        };
      }
    }

    // 5. Check for repeated spam from SAME user (not LLM - simple rule)
    const spamFromUser = this.detectUserSpam(message, context);
    if (spamFromUser) {
      return {
        violation_type: 'spam',
        confidence: 0.9,
        reasoning: `User posted ${spamFromUser.count} very similar messages in ${spamFromUser.windowSeconds}s`,
        recommended_action: 'timeout_1h',
      };
    }

    // LLM ANALYSIS for EXTREME context-dependent violations only
    // (severe harassment, sexual harassment, coordinated attacks)
    try {
      return await this.analyzewithLLM(message, context);
    } catch (error) {
      console.error('[LLM] Error:', error);
      // Fallback to no violation if LLM fails
      return {
        violation_type: 'none',
        confidence: 0.0,
        reasoning: 'LLM analysis unavailable, no rule-based violation detected',
        recommended_action: 'none',
      };
    }
  }

  /**
   * Detect repeated spam from the SAME user
   * Returns spam info if user posted 3+ very similar messages in last 60 seconds
   */
  private detectUserSpam(
    message: ChatMessage,
    context: ChatMessage[]
  ): { count: number; windowSeconds: number } | null {
    const recentWindow = message.received_at - 60000; // Last 60 seconds
    const userMessages = context.filter(
      (m) => m.username === message.username && m.received_at >= recentWindow
    );

    if (userMessages.length < 2) return null; // Need at least 3 total (2 in context + current)

    // Check if current message is very similar to recent messages from same user
    const currentWords = this.getSignificantWords(message.message_text);
    if (currentWords.length === 0) {
      // Short messages like emotes - check exact repetition
      const exactMatches = userMessages.filter(
        (m) => m.message_text.trim() === message.message_text.trim()
      );
      if (exactMatches.length >= 2) {
        // 3+ exact same messages
        return { count: exactMatches.length + 1, windowSeconds: 60 };
      }
      return null;
    }

    // For longer messages, check word overlap
    let similarCount = 0;
    for (const msg of userMessages) {
      const msgWords = this.getSignificantWords(msg.message_text);
      const overlap = currentWords.filter((w) => msgWords.includes(w)).length;
      // 70%+ word overlap = similar
      if (overlap >= currentWords.length * 0.7) {
        similarCount++;
      }
    }

    // Flag if 3+ similar messages from same user
    if (similarCount >= 2) {
      return { count: similarCount + 1, windowSeconds: 60 };
    }

    return null;
  }

  private getSignificantWords(text: string): string[] {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were']);
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w));
  }

  private async analyzewithLLM(
    message: ChatMessage,
    context: ChatMessage[]
  ): Promise<ModerationResult> {
    const contextText = context
      .slice(-5) // Last 5 messages
      .map((m) => `${m.username}: ${m.message_text}`)
      .join('\n');

    // Initial LLM analysis
    const initialResult = await this.runLLMAnalysis(message, contextText);

    // If confidence is low (<0.7), query Knowledge Base for similar violations
    if (initialResult.confidence < 0.7 && this.kbClient?.isConnected()) {
      console.log(
        `[LLM] Low confidence (${initialResult.confidence}), querying Knowledge Base for similar violations`
      );

      const similarViolations = await this.kbClient.searchSimilarViolations(
        message.message_text,
        3, // Get top 3 similar violations
        initialResult.violation_type !== 'none' ? initialResult.violation_type : undefined
      );

      if (similarViolations.violations.length > 0) {
        console.log(
          `[LLM] Found ${similarViolations.violations.length} similar violations, re-analyzing with examples`
        );

        // Re-analyze with examples from Knowledge Base
        return await this.runLLMAnalysisWithExamples(
          message,
          contextText,
          similarViolations.violations
        );
      }
    }

    return initialResult;
  }

  private async runLLMAnalysis(
    message: ChatMessage,
    contextText: string
  ): Promise<ModerationResult> {
    const prompt = `You are a Twitch chat moderator. You are EXTREMELY conservative and only flag SEVERE violations.

CONTEXT (recent messages):
${contextText || 'No context available'}

CURRENT MESSAGE:
User: ${message.username}
Message: "${message.message_text}"

ONLY flag these EXTREME violations:
1. Sexual harassment - EXPLICIT unwanted sexual advances, graphic sexual requests directed at specific people
2. Severe harassment - SUSTAINED, TARGETED personal attacks with clear malicious intent to harm
3. Coordinated attack - Multiple different users working together to harass a specific person

DO NOT FLAG these normal Twitch behaviors:
- Single messages like "rip", "L", "sorry", "sad" - these are NORMAL reactions
- Emote spam (e.g., "BigSad BigSad BigSad") - this is NORMAL Twitch culture
- Questions to the streamer - NORMAL engagement
- Mild criticism or disagreement - NORMAL conversation
- ALL CAPS - just excitement, NOT harassment
- Single negative comments - NOT harassment unless extremely severe
- General rudeness or banter - NORMAL, NOT harassment

CRITICAL RULES:
- If you have ANY doubt, return "none" - be VERY conservative
- Harassment must be EXTREME, TARGETED, and show CLEAR malicious intent
- One-off messages are almost NEVER violations unless they contain explicit threats
- Context matters: consider if this is just normal chat behavior

Respond ONLY with valid JSON:
{
  "violation_type": "harassment" | "sexual_content" | "coordinated_attack" | "none",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation",
  "recommended_action": "flag" | "timeout_1h" | "timeout_24h" | "ban" | "none"
}`;

    return await this.callOllama(prompt);
  }

  private async runLLMAnalysisWithExamples(
    message: ChatMessage,
    contextText: string,
    examples: Array<{
      message: string;
      violation_type: string;
      confidence: number;
      reasoning: string;
      action_taken: string;
      similarity_score: number;
    }>
  ): Promise<ModerationResult> {
    const examplesText = examples
      .map(
        (ex, i) =>
          `Example ${i + 1} (${ex.violation_type}, confidence: ${ex.confidence}):
Message: "${ex.message}"
Reasoning: ${ex.reasoning}
Action: ${ex.action_taken}
Similarity: ${(ex.similarity_score * 100).toFixed(0)}%`
      )
      .join('\n\n');

    const prompt = `You are a Twitch chat moderator. You are EXTREMELY conservative and only flag SEVERE violations.

CONTEXT (recent messages):
${contextText || 'No context available'}

CURRENT MESSAGE:
User: ${message.username}
Message: "${message.message_text}"

SIMILAR PAST VIOLATIONS (for reference - be consistent with these decisions):
${examplesText}

ONLY flag these EXTREME violations:
1. Sexual harassment - EXPLICIT unwanted sexual advances, graphic sexual requests directed at specific people
2. Severe harassment - SUSTAINED, TARGETED personal attacks with clear malicious intent to harm
3. Coordinated attack - Multiple different users working together to harass a specific person

DO NOT FLAG these normal Twitch behaviors:
- Single messages like "rip", "L", "sorry", "sad" - these are NORMAL reactions
- Emote spam (e.g., "BigSad BigSad BigSad") - this is NORMAL Twitch culture
- Questions to the streamer - NORMAL engagement
- Mild criticism or disagreement - NORMAL conversation
- ALL CAPS - just excitement, NOT harassment
- Single negative comments - NOT harassment unless extremely severe
- General rudeness or banter - NORMAL, NOT harassment

CRITICAL RULES:
- Consider the similar past violations above for consistency
- If you have ANY doubt, return "none" - be VERY conservative
- Harassment must be EXTREME, TARGETED, and show CLEAR malicious intent
- One-off messages are almost NEVER violations unless they contain explicit threats
- Context matters: consider if this is just normal chat behavior

Respond ONLY with valid JSON:
{
  "violation_type": "harassment" | "sexual_content" | "coordinated_attack" | "none",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation (mention if similar to past violations)",
  "recommended_action": "flag" | "timeout_1h" | "timeout_24h" | "ban" | "none"
}`;

    return await this.callOllama(prompt);
  }

  private async callOllama(prompt: string): Promise<ModerationResult> {
    const response = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        prompt,
        stream: false,
        format: 'json',
        options: {
          temperature: 0.3, // Low temperature for consistent decisions
          num_predict: 200,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.response);

    // Ensure result matches our types
    return {
      violation_type: result.violation_type || 'none',
      confidence: Math.min(1.0, Math.max(0.0, result.confidence || 0.0)),
      reasoning: result.reasoning || 'LLM analysis complete',
      recommended_action: result.recommended_action || 'none',
    };
  }
}
