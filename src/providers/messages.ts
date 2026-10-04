/**
 * Helpers shared by provider adapters.
 *
 * Dependency direction: messages.ts → providers/types.ts
 * Used by: provider adapters
 */

import type { StopReason, TokenUsage } from './types.js';

/**
 * Map a provider finish reason to a normalized StopReason.
 * Covers Anthropic, OpenAI-compatible, Gemini, and Ollama spellings.
 */
export function normalizeStopReason(raw: string | undefined | null): StopReason {
    switch (raw) {
        case 'end_turn':
        case 'stop':
        case 'stop_sequence':
        case 'STOP':
            return 'end_turn';
        case 'tool_use':
        case 'tool_calls':
        case 'function_call':
            return 'tool_use';
        case 'max_tokens':
        case 'length':
        case 'MAX_TOKENS':
            return 'max_tokens';
        default:
            return 'other';
    }
}

/** Usage with every counter at zero. */
export const EMPTY_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** Sum two usage records. Cache counters are kept only when either side has them. */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
    const cacheRead = (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0);
    const cacheWrite = (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0);
    return {
        promptTokens: a.promptTokens + b.promptTokens,
        completionTokens: a.completionTokens + b.completionTokens,
        totalTokens: a.totalTokens + b.totalTokens,
        ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
        ...(cacheWrite ? { cacheWriteTokens: cacheWrite } : {}),
    };
}
