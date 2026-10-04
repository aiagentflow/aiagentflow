import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicProvider } from '../../src/providers/anthropic.js';
import type { ChatChunk } from '../../src/providers/types.js';

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function sseResponse(events: unknown[]): Response {
    const text = events.map(e => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('');
    return new Response(text, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('AnthropicProvider tool calling', () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns tool calls instead of executing them', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            model: 'claude-test',
            stop_reason: 'tool_use',
            content: [
                { type: 'text', text: 'Let me read it.' },
                { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/a.ts' } },
            ],
            usage: { input_tokens: 12, output_tokens: 8 },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const res = await provider.chat([{ role: 'user', content: 'hi' }], {
            tools: [{ name: 'read_file', description: 'Read', inputSchema: { type: 'object' } }],
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(res.stopReason).toBe('tool_use');
        expect(res.content).toBe('Let me read it.');
        expect(res.toolCalls).toEqual([{ callId: 'toolu_1', name: 'read_file', input: { path: 'src/a.ts' } }]);
        expect(res.usage.totalTokens).toBe(20);

        const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
        expect(body.tools).toEqual([{ name: 'read_file', description: 'Read', input_schema: { type: 'object' } }]);
    });

    it('serializes assistant tool calls and tool results as content blocks', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }], usage: {},
        }));
        vi.stubGlobal('fetch', fetchMock);

        const res = await provider.chat([
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'go' },
            { role: 'assistant', content: 'calling', toolCalls: [{ callId: 't1', name: 'grep', input: { q: 'x' } }] },
            { role: 'tool', results: [{ callId: 't1', content: 'no matches', isError: true }] },
        ]);

        expect(res.stopReason).toBe('end_turn');
        expect(res.toolCalls).toEqual([]);
        const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
        expect(body.system).toBe('sys');
        expect(body.messages).toEqual([
            { role: 'user', content: 'go' },
            { role: 'assistant', content: [
                { type: 'text', text: 'calling' },
                { type: 'tool_use', id: 't1', name: 'grep', input: { q: 'x' } },
            ] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'no matches', is_error: true }] },
        ]);
    });

    it('streams text and assembles tool calls from input_json_delta events', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
            { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi ' } },
            { type: 'content_block_stop', index: 0 },
            { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_9', name: 'list_dir' } },
            { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"pa' } },
            { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'th":"src"}' } },
            { type: 'content_block_stop', index: 1 },
            { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
            { type: 'message_stop' },
        ])));

        const chunks: ChatChunk[] = [];
        for await (const chunk of provider.stream([{ role: 'user', content: 'hi' }])) chunks.push(chunk);

        expect(chunks.map(c => c.content).join('')).toBe('Hi ');
        expect(chunks.flatMap(c => c.toolCalls ?? [])).toEqual([{ callId: 'toolu_9', name: 'list_dir', input: { path: 'src' } }]);
        expect(chunks.at(-1)).toMatchObject({ done: true, stopReason: 'tool_use' });
    });
});
