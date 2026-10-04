/**
 * Helpers shared by provider adapters.
 *
 * Dependency direction: messages.ts → providers/types.ts
 * Used by: provider adapters
 */

import type { StopReason } from './types.js';

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
