import { describe, it, expect, vi, afterEach } from 'vitest';
import { GeminiProvider, prepareContents, toGeminiSchema } from '../../src/providers/gemini.js';
import type { ChatChunk } from '../../src/providers/types.js';

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function sseResponse(events: unknown[]): Response {
    return new Response(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''), { status: 200 });
}

function stubFetch(response: Response) {
    const fn = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fn);
    return fn;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

const provider = new GeminiProvider({ apiKey: 'test-key' });
const READ_TOOL = {
    name: 'read_file',
    description: 'Read a file',
    inputSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: { path: { type: 'string', default: '.' }, additionalProperties: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
    },
};

describe('GeminiProvider function calling', () => {
    it('declares tools and returns function calls with tool_use stop reason', async () => {
        const fetchMock = stubFetch(jsonResponse({
            candidates: [{
                finishReason: 'STOP',
                content: { role: 'model', parts: [
                    { text: 'Reading.' },
                    { functionCall: { name: 'read_file', args: { path: 'src/a.ts' } }, thoughtSignature: 'sig-abc' },
                ] },
            }],
            usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4, totalTokenCount: 13 },
        }));

        const res = await provider.chat([{ role: 'user', content: 'hi' }], { tools: [READ_TOOL] });

        expect(res.stopReason).toBe('tool_use');
        expect(res.content).toBe('Reading.');
        expect(res.toolCalls).toEqual([{
            callId: 'gemini_call_0', name: 'read_file', input: { path: 'src/a.ts' }, metadata: { thoughtSignature: 'sig-abc' },
        }]);

        const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
        expect(body.tools).toEqual([{ functionDeclarations: [{
            name: 'read_file',
            description: 'Read a file',
            parameters: { type: 'object', properties: { path: { type: 'string' }, additionalProperties: { type: 'string' } }, required: ['path'] },
        }] }]);
    });

    it('uses the id Gemini returns when present', async () => {
        stubFetch(jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { id: 'fc_1', name: 'grep', args: {} } }] } }] }));
        const res = await provider.chat([{ role: 'user', content: 'hi' }]);
        expect(res.toolCalls[0]!.callId).toBe('fc_1');
    });

    it('keeps STOP as end_turn when no function is called', async () => {
        stubFetch(jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'done' }] } }] }));
        const res = await provider.chat([{ role: 'user', content: 'hi' }]);
        expect(res).toMatchObject({ stopReason: 'end_turn', toolCalls: [], content: 'done' });
    });

    it('streams text and function calls', async () => {
        stubFetch(sseResponse([
            { candidates: [{ content: { parts: [{ text: 'Let me ' }] } }] },
            { candidates: [{ content: { parts: [{ text: 'check.' }, { functionCall: { name: 'list_dir', args: { path: 'src' } } }] }, finishReason: 'STOP' }] },
        ]));

        const chunks: ChatChunk[] = [];
        for await (const c of provider.stream([{ role: 'user', content: 'hi' }], { tools: [READ_TOOL] })) chunks.push(c);

        expect(chunks.map(c => c.content).join('')).toBe('Let me check.');
        expect(chunks.flatMap(c => c.toolCalls ?? [])).toEqual([{ callId: 'gemini_call_0', name: 'list_dir', input: { path: 'src' } }]);
        expect(chunks.at(-1)).toEqual({ content: '', done: true, stopReason: 'tool_use' });
    });
});

describe('prepareContents', () => {
    it('maps tool turns to functionCall/functionResponse parts and echoes thought signatures', () => {
        const { contents, systemInstruction } = prepareContents([
            { role: 'user', content: 'go' },
            { role: 'assistant', content: '', toolCalls: [
                { callId: 'gemini_call_0', name: 'read_file', input: { path: 'a.ts' }, metadata: { thoughtSignature: 'sig' } },
            ] },
            { role: 'tool', results: [{ callId: 'gemini_call_0', content: 'body' }] },
            { role: 'assistant', content: 'retry', toolCalls: [{ callId: 'c2', name: 'grep', input: {} }] },
            { role: 'tool', results: [{ callId: 'c2', content: 'nope', isError: true }] },
        ], 'sys');

        expect(systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
        expect(contents).toEqual([
            { role: 'user', parts: [{ text: 'go' }] },
            { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'a.ts' } }, thoughtSignature: 'sig' }] },
            { role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { content: 'body' } } }] },
            { role: 'model', parts: [{ text: 'retry' }, { functionCall: { name: 'grep', args: {} } }] },
            { role: 'user', parts: [{ functionResponse: { name: 'grep', response: { error: 'nope' } } }] },
        ]);
    });
});

describe('toGeminiSchema', () => {
    it('strips unsupported keywords recursively but keeps property names', () => {
        expect(toGeminiSchema({
            type: 'object',
            additionalProperties: false,
            properties: { default: { type: 'string', default: 'x' }, items: { type: 'array', items: { type: 'string', examples: ['a'] } } },
        })).toEqual({
            type: 'object',
            properties: { default: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } },
        });
    });
});
