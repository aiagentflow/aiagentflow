/**
 * Context window optimizer with sliding window management.
 *
 * Manages long conversations by implementing a sliding window strategy
 * to keep context within token limits while preserving important messages.
 *
 * Dependency direction: context-optimizer.ts → nothing (leaf module)
 * Used by: agents, workflow engine
 */

import { logger } from './logger.js';
import type { ChatMessage } from '../providers/types.js';

/** Token counting options. */
export interface TokenCountOptions {
  /** Approximate tokens per character (default: 0.25). */
  tokensPerChar?: number;
  /** Overhead per message (system prompts, etc.). */
  messageOverhead?: number;
}

/** Context window optimization options. */
export interface ContextOptimizerOptions {
  /** Maximum tokens in context window. */
  maxTokens?: number;
  /** Minimum tokens to keep from recent messages. */
  minRecentTokens?: number;
  /** Whether to keep system messages. */
  keepSystemMessages?: boolean;
  /** Token counting options. */
  tokenCountOptions?: TokenCountOptions;
}

/** Optimized context with metadata. */
export interface OptimizedContext {
  /** Optimized messages list. */
  messages: ChatMessage[];
  /** Total tokens in optimized context. */
  tokenCount: number;
  /** Number of messages removed. */
  messagesRemoved: number;
}

/** Message importance score. */
interface MessageScore {
  /** Index in original messages array. */
  index: number;
  /** Importance score (higher = more important). */
  score: number;
  /** Token count. */
  tokens: number;
}

/** Default configuration values. */
const DEFAULTS = {
  maxTokens: 100000,
  minRecentTokens: 20000,
  keepSystemMessages: true,
  tokensPerChar: 0.25,
  messageOverhead: 10,
} as const;

/**
 * Context window optimizer with sliding window strategy.
 */
export class ContextOptimizer {
  private readonly options: Required<ContextOptimizerOptions>;
  private readonly tokenOptions: Required<TokenCountOptions>;

  constructor(options: ContextOptimizerOptions = {}) {
    const tokenCountDefaults: Required<TokenCountOptions> = {
      tokensPerChar: DEFAULTS.tokensPerChar,
      messageOverhead: DEFAULTS.messageOverhead,
    };

    const mergedTokenCountOptions = {
      ...tokenCountDefaults,
      ...(options.tokenCountOptions ?? {}),
    };

    this.options = {
      maxTokens: options.maxTokens ?? DEFAULTS.maxTokens,
      minRecentTokens: options.minRecentTokens ?? DEFAULTS.minRecentTokens,
      keepSystemMessages: options.keepSystemMessages ?? DEFAULTS.keepSystemMessages,
      tokenCountOptions: mergedTokenCountOptions,
    };
    this.tokenOptions = mergedTokenCountOptions;

    logger.debug(
      `Context optimizer initialized: maxTokens=${this.options.maxTokens}, ` +
        `minRecentTokens=${this.options.minRecentTokens}`,
    );
  }

  /**
   * Optimize a list of messages to fit within token limits.
   *
   * Uses a sliding window strategy that:
   * 1. Keeps system messages if configured
   * 2. Keeps recent messages above the minimum threshold
   * 3. Preserves important messages from earlier in the conversation
   *
   * @param messages - Messages to optimize
   * @returns Optimized context with metadata
   */
  optimize(messages: ChatMessage[]): OptimizedContext {
    const originalCount = messages.length;
    const originalTokens = this.countTokens(messages);

    if (originalTokens <= this.options.maxTokens) {
      logger.debug(`Context fits (${originalTokens}/${this.options.maxTokens} tokens)`);
      return {
        messages,
        tokenCount: originalTokens,
        messagesRemoved: 0,
      };
    }

    logger.debug(
      `Context exceeds limit (${originalTokens}/${this.options.maxTokens} tokens), optimizing...`,
    );

    const optimized = this.applySlidingWindow(messages);
    const removedCount = originalCount - optimized.messages.length;

    logger.info(
      `Optimized context: ${originalTokens} → ${optimized.tokenCount} tokens, ` +
        `${originalCount} → ${optimized.messages.length} messages (${removedCount} removed)`,
    );

    return optimized;
  }

  /**
   * Estimate token count for a list of messages.
   *
   * @param messages - Messages to count
   * @returns Estimated token count
   */
  countTokens(messages: ChatMessage[]): number {
    let total = 0;

    for (const msg of messages) {
      total += this.tokenOptions.messageOverhead;
      total += Math.ceil(msg.content.length * this.tokenOptions.tokensPerChar);
    }

    return total;
  }

  /**
   * Truncate messages to fit within a specific token limit.
   *
   * @param messages - Messages to truncate
   * @param targetTokens - Target token limit
   * @returns Truncated messages
   */
  truncateToTokens(messages: ChatMessage[], targetTokens: number): ChatMessage[] {
    const result: ChatMessage[] = [];
    let currentTokens = 0;

    for (const msg of messages) {
      const msgTokens = this.countTokens([msg]);

      if (currentTokens + msgTokens > targetTokens) {
        break;
      }

      result.push(msg);
      currentTokens += msgTokens;
    }

    return result;
  }

  // ── Private helpers ──

  private applySlidingWindow(messages: ChatMessage[]): OptimizedContext {
    const systemMessages: ChatMessage[] = [];
    const otherMessages: ChatMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system' && this.options.keepSystemMessages) {
        systemMessages.push(msg);
      } else {
        otherMessages.push(msg);
      }
    }

    const systemTokens = this.countTokens(systemMessages);
    const availableTokens = this.options.maxTokens - systemTokens;

    if (availableTokens <= 0) {
      return {
        messages: systemMessages.slice(0, 1),
        tokenCount: this.countTokens(systemMessages.slice(0, 1)),
        messagesRemoved: messages.length - 1,
      };
    }

    const optimizedOther = this.optimizeOtherMessages(otherMessages, availableTokens);
    const finalMessages = [...systemMessages, ...optimizedOther];

    return {
      messages: finalMessages,
      tokenCount: this.countTokens(finalMessages),
      messagesRemoved: messages.length - finalMessages.length,
    };
  }

  private optimizeOtherMessages(messages: ChatMessage[], availableTokens: number): ChatMessage[] {
    if (messages.length === 0) {
      return [];
    }

    const totalTokens = this.countTokens(messages);

    if (totalTokens <= availableTokens) {
      return messages;
    }

    const scoredMessages = this.scoreMessages(messages);
    const minRecent = this.options.minRecentTokens;

    let recentTokens = 0;
    const recentMessages: ChatMessage[] = [];

    for (let i = scoredMessages.length - 1; i >= 0; i--) {
      const msg = scoredMessages[i];
      if (!msg || recentTokens + msg.tokens > minRecent) {
        break;
      }
      const originalMsg = messages[msg.index];
      if (originalMsg) {
        recentMessages.unshift(originalMsg);
        recentTokens += msg.tokens;
      }
    }

    const remainingTokens = availableTokens - recentTokens;
    const importantMessages = this.selectImportantMessages(
      scoredMessages.slice(0, scoredMessages.length - recentMessages.length),
      remainingTokens,
    );

    const importantMessagesFiltered = importantMessages
      .map((m) => messages[m.index])
      .filter((m): m is ChatMessage => m !== undefined);

    return [...importantMessagesFiltered, ...recentMessages];
  }

  private scoreMessages(messages: ChatMessage[]): MessageScore[] {
    return messages.map((msg, index) => ({
      index,
      score: this.calculateMessageScore(msg, index, messages.length),
      tokens: this.countTokens([msg]),
    }));
  }

  private calculateMessageScore(msg: ChatMessage, index: number, total: number): number {
    let score = 0;

    if (msg.role === 'system') {
      score = 100;
    } else if (msg.role === 'assistant' && msg.content.toLowerCase().includes('error')) {
      score = 80;
    } else if (msg.role === 'user' && msg.content.length > 500) {
      score = 70;
    }

    const recentness = (index + 1) / total;
    score += recentness * 50;

    const lengthScore = Math.min(msg.content.length / 1000, 1) * 20;
    score += lengthScore;

    return score;
  }

  private selectImportantMessages(
    messages: MessageScore[],
    availableTokens: number,
  ): MessageScore[] {
    const sorted = [...messages].sort((a, b) => b.score - a.score);

    const selected: MessageScore[] = [];
    let usedTokens = 0;

    for (const msg of sorted) {
      if (usedTokens + msg.tokens > availableTokens) {
        continue;
      }
      selected.push(msg);
      usedTokens += msg.tokens;
    }

    return selected.sort((a, b) => a.index - b.index);
  }
}

/**
 * Global context optimizer instance.
 */
let globalOptimizer: ContextOptimizer | null = null;

/**
 * Get or create the global context optimizer.
 */
export function getContextOptimizer(options?: ContextOptimizerOptions): ContextOptimizer {
  if (!globalOptimizer) {
    globalOptimizer = new ContextOptimizer(options);
  }
  return globalOptimizer;
}
