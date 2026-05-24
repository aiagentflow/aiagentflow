/**
 * Tests for the OpenRouterProvider adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterProvider } from '../../src/providers/openrouter.js';
import { ProviderError } from '../../src/core/errors.js';

// Stub fetchWithRetry so no real HTTP calls are made
vi.mock('../../src/providers/provider-errors.js', () => ({
    fetchWithRetry: vi.fn(),
    PROVIDER_TIMEOUT_MS: 30_000,
}));

import { fetchWithRetry } from '../../src/providers/provider-errors.js';

const mockFetch = vi.mocked(fetchWithRetry);

function makeProvider() {
    return new OpenRouterProvider({ apiKey: 'or-test-key-12345678' });
}

function makeJsonResponse(body: unknown): Response {
    return {
        ok: true,
        json: () => Promise.resolve(body),
        body: null,
    } as unknown as Response;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('OpenRouterProvider constructor', () => {
    it('throws ProviderError when apiKey is empty', () => {
        expect(() => new OpenRouterProvider({ apiKey: '' })).toThrow(ProviderError);
    });

    it('sets default baseUrl when not provided', () => {
        const provider = makeProvider();
        expect(provider.name).toBe('openrouter');
    });

    it('accepts a custom baseUrl', () => {
        const provider = new OpenRouterProvider({
            apiKey: 'or-test-key-12345678',
            baseUrl: 'https://custom.openrouter.example/v1',
        });
        expect(provider.name).toBe('openrouter');
    });
});

describe('OpenRouterProvider.chat', () => {
    it('sends request and returns content', async () => {
        mockFetch.mockResolvedValueOnce(makeJsonResponse({
            choices: [{ message: { content: 'Hello from OpenRouter' }, finish_reason: 'stop' }],
            model: 'meta-llama/llama-3.1-8b-instruct:free',
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }));

        const provider = makeProvider();
        const response = await provider.chat([{ role: 'user', content: 'Hi' }]);

        expect(response.content).toBe('Hello from OpenRouter');
        expect(response.usage.totalTokens).toBe(15);
        expect(response.model).toBe('meta-llama/llama-3.1-8b-instruct:free');
    });

    it('includes system prompt when provided', async () => {
        mockFetch.mockResolvedValueOnce(makeJsonResponse({
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
            model: 'meta-llama/llama-3.1-8b-instruct:free',
            usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 },
        }));

        const provider = makeProvider();
        await provider.chat(
            [{ role: 'user', content: 'test' }],
            { systemPrompt: 'You are a helpful assistant.' },
        );

        const [, init] = mockFetch.mock.calls[0]!;
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant.' });
    });

    it('sends HTTP-Referer and X-Title headers', async () => {
        mockFetch.mockResolvedValueOnce(makeJsonResponse({
            choices: [{ message: { content: '' }, finish_reason: 'stop' }],
            model: 'meta-llama/llama-3.1-8b-instruct:free',
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }));

        const provider = makeProvider();
        await provider.chat([{ role: 'user', content: 'hi' }]);

        const [, init] = mockFetch.mock.calls[0]!;
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers['HTTP-Referer']).toBeDefined();
        expect(headers['X-Title']).toBeDefined();
    });
});

describe('OpenRouterProvider.listModels', () => {
    it('returns model list from API', async () => {
        mockFetch.mockResolvedValueOnce(makeJsonResponse({
            data: [
                { id: 'meta-llama/llama-3.1-8b-instruct:free', context_length: 131072 },
                { id: 'google/gemma-3-12b-it:free', context_length: 8192 },
            ],
        }));

        const provider = makeProvider();
        const models = await provider.listModels();

        expect(models).toHaveLength(2);
        expect(models[0]!.id).toBe('meta-llama/llama-3.1-8b-instruct:free');
        expect(models[0]!.provider).toBe('openrouter');
        expect(models[0]!.contextWindow).toBe(131072);
    });

    it('returns empty array when data is missing', async () => {
        mockFetch.mockResolvedValueOnce(makeJsonResponse({}));

        const provider = makeProvider();
        const models = await provider.listModels();
        expect(models).toHaveLength(0);
    });
});

describe('OpenRouterProvider.validateConnection', () => {
    it('returns true when the models endpoint responds ok', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce({ ok: true }) as unknown as typeof fetch;

        const provider = makeProvider();
        const result = await provider.validateConnection();
        expect(result).toBe(true);
    });

    it('returns false when fetch throws', async () => {
        global.fetch = vi.fn().mockRejectedValueOnce(new Error('network error')) as unknown as typeof fetch;

        const provider = makeProvider();
        const result = await provider.validateConnection();
        expect(result).toBe(false);
    });
});
