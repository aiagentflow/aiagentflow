import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai.js';
import { GroqProvider } from '../../src/providers/groq.js';
import { OllamaProvider } from '../../src/providers/ollama.js';
import { OpenRouterProvider } from '../../src/providers/openrouter.js';
import { toApiMessages } from '../../src/providers/openai-compatible.js';
import type { ChatChunk } from '../../src/providers/types.js';

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function sseResponse(events: Array<unknown | '[DONE]'>): Response {
    const text = events.map(e => `data: ${e === '[DONE]' ? e : JSON.stringify(e)}\n\n`).join('');
    return new Response(text, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function stubFetch(response: Response) {
    const fn = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fn);
    return fn;
}

const sentBody = (fn: ReturnType<typeof vi.fn>) => JSON.parse(fn.mock.calls[0]![1].body as string);
const sentUrl = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[0]![0] as string;

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('toApiMessages', () => {
    it('maps tool calls and tool results to the OpenAI wire format', () => {
        expect(toApiMessages([
            { role: 'user', content: 'go' },
            { role: 'assistant', content: '', toolCalls: [{ callId: 'c1', name: 'grep', input: { q: 'x' } }] },
            { role: 'tool', results: [{ callId: 'c1', content: 'hit' }, { callId: 'c2', content: 'bad path', isError: true }] },
        ], 'sys')).toEqual([
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'go' },
            { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'grep', arguments: '{"q":"x"}' } }] },
            { role: 'tool', tool_call_id: 'c1', content: 'hit' },
            { role: 'tool', tool_call_id: 'c2', content: 'Error: bad path' },
        ]);
    });
});

describe('OpenAICompatibleProvider.chat', () => {
    it('sends tools and returns parsed tool calls', async () => {
        const fetchMock = stubFetch(jsonResponse({
            model: 'gpt-test',
            choices: [{
                finish_reason: 'tool_calls',
                message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }] },
            }],
            usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
        }));

        const res = await new OpenAIProvider({ apiKey: 'k' }).chat([{ role: 'user', content: 'hi' }], {
            tools: [{ name: 'read_file', description: 'Read', inputSchema: { type: 'object' } }],
            maxTokens: 100,
        });

        expect(res).toMatchObject({ content: '', stopReason: 'tool_use', usage: { totalTokens: 10 } });
        expect(res.toolCalls).toEqual([{ callId: 'call_1', name: 'read_file', input: { path: 'a.ts' } }]);

        const body = sentBody(fetchMock);
        expect(body.tools).toEqual([{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: { type: 'object' } } }]);
        expect(body.max_tokens).toBe(100);
        expect(sentUrl(fetchMock)).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('tolerates malformed tool arguments', async () => {
        stubFetch(jsonResponse({
            choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'x', type: 'function', function: { name: 't', arguments: '{oops' } }] } }],
        }));
        const res = await new OpenAIProvider({ apiKey: 'k' }).chat([{ role: 'user', content: 'hi' }]);
        expect(res.toolCalls).toEqual([{ callId: 'x', name: 't', input: {} }]);
    });
});

describe('OpenAICompatibleProvider.stream', () => {
    it('assembles tool call fragments and keeps reading past finish_reason until [DONE]', async () => {
        stubFetch(sseResponse([
            { choices: [{ delta: { content: 'Hel' } }] },
            { choices: [{ delta: { content: 'lo' } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'list_', arguments: '{"pa' } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'dir', arguments: 'th":"src"}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
            { choices: [{ delta: { content: '!' } }] },
            '[DONE]',
        ]));

        const chunks: ChatChunk[] = [];
        for await (const c of new GroqProvider({ apiKey: 'k' }).stream([{ role: 'user', content: 'hi' }])) chunks.push(c);

        expect(chunks.map(c => c.content).join('')).toBe('Hello!');
        expect(chunks.flatMap(c => c.toolCalls ?? [])).toEqual([{ callId: 'c1', name: 'list_dir', input: { path: 'src' } }]);
        expect(chunks.at(-1)).toEqual({ content: '', done: true, stopReason: 'tool_use' });
    });
});

describe('provider settings', () => {
    const ok = () => jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });

    it('Groq uses max_completion_tokens and the /openai/v1 base', async () => {
        const fetchMock = stubFetch(ok());
        await new GroqProvider({ apiKey: 'k' }).chat([{ role: 'user', content: 'hi' }], { maxTokens: 50 });
        expect(sentUrl(fetchMock)).toBe('https://api.groq.com/openai/v1/chat/completions');
        expect(sentBody(fetchMock).max_completion_tokens).toBe(50);
    });

    it('OpenAI accepts a base URL that already ends in /v1', async () => {
        const fetchMock = stubFetch(ok());
        await new OpenAIProvider({ apiKey: 'k', baseUrl: 'http://proxy.local/v1/' }).chat([{ role: 'user', content: 'hi' }]);
        expect(sentUrl(fetchMock)).toBe('http://proxy.local/v1/chat/completions');
    });

    it('OpenRouter sends attribution headers', async () => {
        const fetchMock = stubFetch(ok());
        await new OpenRouterProvider({ apiKey: 'k' }).chat([{ role: 'user', content: 'hi' }]);
        const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
        expect(headers['X-Title']).toBe('aiagentflow');
        expect(headers.Authorization).toBe('Bearer k');
    });

    it('Ollama chats via /v1 and lists models via /api/tags', async () => {
        const chatFetch = stubFetch(ok());
        const ollama = new OllamaProvider({ baseUrl: 'http://localhost:11434/' });
        await ollama.chat([{ role: 'user', content: 'hi' }]);
        expect(sentUrl(chatFetch)).toBe('http://localhost:11434/v1/chat/completions');

        const tagsFetch = stubFetch(jsonResponse({ models: [{ name: 'llama3.2:latest' }] }));
        expect(await ollama.listModels()).toEqual([{ id: 'llama3.2:latest', name: 'llama3.2:latest', provider: 'ollama' }]);
        expect(sentUrl(tagsFetch)).toBe('http://localhost:11434/api/tags');
    });
});

describe('usage reporting', () => {
    it('requests stream usage and reads the final usage chunk, including cached tokens', async () => {
        const fetchMock = stubFetch(sseResponse([
            { choices: [{ delta: { content: 'Hi' } }] },
            { choices: [{ delta: {}, finish_reason: 'stop' }] },
            { choices: [], usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128, prompt_tokens_details: { cached_tokens: 100 } } },
            '[DONE]',
        ]));
        const chunks: ChatChunk[] = [];
        for await (const c of new OpenAIProvider({ apiKey: 'k' }).stream([{ role: 'user', content: 'hi' }])) chunks.push(c);

        expect(sentBody(fetchMock).stream_options).toEqual({ include_usage: true });
        expect(chunks.at(-1)?.usage).toEqual({ promptTokens: 120, completionTokens: 8, totalTokens: 128, cacheReadTokens: 100 });
    });

    it('reads Groq usage from x_groq', async () => {
        stubFetch(sseResponse([
            { choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }], x_groq: { usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } } },
            '[DONE]',
        ]));
        const chunks: ChatChunk[] = [];
        for await (const c of new GroqProvider({ apiKey: 'k' }).stream([{ role: 'user', content: 'hi' }])) chunks.push(c);
        expect(chunks.at(-1)?.usage).toEqual({ promptTokens: 5, completionTokens: 1, totalTokens: 6 });
    });
});
