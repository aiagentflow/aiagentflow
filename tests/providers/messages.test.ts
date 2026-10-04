import { describe, it, expect } from 'vitest';
import { toPlainMessages, normalizeStopReason } from '../../src/providers/messages.js';

describe('toPlainMessages', () => {
    it('passes text messages through', () => {
        expect(toPlainMessages([
            { role: 'system', content: 's' },
            { role: 'user', content: 'u' },
            { role: 'assistant', content: 'a' },
        ])).toEqual([
            { role: 'system', content: 's' },
            { role: 'user', content: 'u' },
            { role: 'assistant', content: 'a' },
        ]);
    });

    it('renders tool calls and results as text', () => {
        const plain = toPlainMessages([
            { role: 'assistant', content: 'Looking', toolCalls: [{ callId: 'c1', name: 'read_file', input: { path: 'a.ts' } }] },
            { role: 'tool', results: [{ callId: 'c1', content: 'file body', isError: false }, { callId: 'c2', content: 'boom', isError: true }] },
        ]);
        expect(plain[0]).toEqual({ role: 'assistant', content: 'Looking\n[tool call c1] read_file {"path":"a.ts"}' });
        expect(plain[1]!.role).toBe('user');
        expect(plain[1]!.content).toContain('[tool result c1]\nfile body');
        expect(plain[1]!.content).toContain('[tool result c2 (error)]\nboom');
    });
});

describe('normalizeStopReason', () => {
    it.each([
        ['end_turn', 'end_turn'], ['stop', 'end_turn'], ['STOP', 'end_turn'], ['stop_sequence', 'end_turn'],
        ['tool_use', 'tool_use'], ['tool_calls', 'tool_use'],
        ['max_tokens', 'max_tokens'], ['length', 'max_tokens'], ['MAX_TOKENS', 'max_tokens'],
        ['content_filter', 'other'], [undefined, 'other'],
    ])('%s -> %s', (raw, expected) => {
        expect(normalizeStopReason(raw)).toBe(expected);
    });
});
