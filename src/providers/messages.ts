/**
 * Message helpers shared by provider adapters.
 *
 * Dependency direction: messages.ts → providers/types.ts
 * Used by: provider adapters
 */

import type { ChatMessage, StopReason } from './types.js';

/** A message reduced to plain text, for APIs without native tool support. */
export interface PlainMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Flatten tool calls and tool results into plain text messages.
 *
 * Used by adapters that do not (yet) send native tool messages, so a
 * conversation that contains tool turns can still be replayed.
 */
export function toPlainMessages(messages: readonly ChatMessage[]): PlainMessage[] {
    return messages.map((msg): PlainMessage => {
        if (msg.role === 'tool') {
            const body = msg.results
                .map(r => `[tool result ${r.callId}${r.isError ? ' (error)' : ''}]\n${r.content}`)
                .join('\n\n');
            return { role: 'user', content: body };
        }
        if (msg.role === 'assistant' && msg.toolCalls?.length) {
            const calls = msg.toolCalls
                .map(c => `[tool call ${c.callId}] ${c.name} ${JSON.stringify(c.input)}`)
                .join('\n');
            return { role: 'assistant', content: msg.content ? `${msg.content}\n${calls}` : calls };
        }
        return { role: msg.role, content: msg.content };
    });
}

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
