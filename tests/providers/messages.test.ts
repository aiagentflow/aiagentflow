import { describe, it, expect } from 'vitest';
import { normalizeStopReason } from '../../src/providers/messages.js';

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
