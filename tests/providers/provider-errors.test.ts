import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getHttpErrorHint,
    getConnectionErrorHint,
    buildHttpError,
    buildConnectionError,
    isRetryableStatus,
    fetchWithRetry,
    PROVIDER_TIMEOUT_MS,
    OLLAMA_TIMEOUT_MS,
} from '../../src/providers/provider-errors.js';
import { ProviderError } from '../../src/core/errors.js';

describe('getHttpErrorHint', () => {
    it('returns API key hint for 401', () => {
        const hint = getHttpErrorHint(401, 'openai');
        expect(hint).toContain('API key');
        expect(hint).toContain('.aiagentflow/config.json');
    });

    it('returns API key hint for 403', () => {
        const hint = getHttpErrorHint(403, 'anthropic');
        expect(hint).toContain('API key');
    });

    it('returns URL/model hint for 404', () => {
        const hint = getHttpErrorHint(404, 'gemini');
        expect(hint).toContain('base URL');
        expect(hint).toContain('model name');
    });

    it('returns rate limit hint for 429', () => {
        const hint = getHttpErrorHint(429, 'openai');
        expect(hint).toContain('Rate limited');
        expect(hint).toContain('wait');
    });

    it('returns server error hint for 500', () => {
        const hint = getHttpErrorHint(500, 'anthropic');
        expect(hint).toContain('server issues');
    });

    it('returns server error hint for 503', () => {
        const hint = getHttpErrorHint(503, 'gemini');
        expect(hint).toContain('server issues');
    });

    it('returns empty string for unknown status codes', () => {
        expect(getHttpErrorHint(418, 'openai')).toBe('');
    });
});

describe('getConnectionErrorHint', () => {
    it('detects ECONNREFUSED', () => {
        const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
        const hint = getConnectionErrorHint(err, 'openai', 'https://api.openai.com');
        expect(hint).toContain('Cannot reach');
        expect(hint).toContain('is the service running');
    });

    it('shows Ollama-specific hint for ECONNREFUSED', () => {
        const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
        const hint = getConnectionErrorHint(err, 'ollama', 'http://localhost:11434');
        expect(hint).toContain('ollama serve');
    });

    it('detects ENOTFOUND', () => {
        const err = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
        const hint = getConnectionErrorHint(err, 'anthropic', 'https://api.anthropic.com');
        expect(hint).toContain('DNS lookup failed');
    });

    it('detects ETIMEDOUT', () => {
        const err = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
        const hint = getConnectionErrorHint(err, 'openai', 'https://api.openai.com');
        expect(hint).toContain('timed out');
    });

    it('detects AbortError (timeout)', () => {
        const err = new DOMException('signal timed out', 'AbortError');
        const hint = getConnectionErrorHint(err, 'gemini', 'https://generativelanguage.googleapis.com');
        expect(hint).toContain('timed out');
    });

    it('returns empty string for unknown errors', () => {
        const err = new Error('something unexpected');
        const hint = getConnectionErrorHint(err, 'openai', 'https://api.openai.com');
        expect(hint).toBe('');
    });
});

describe('buildHttpError', () => {
    it('returns a ProviderError with hint for 401', () => {
        const err = buildHttpError(401, 'Unauthorized', 'openai', '{"error":"invalid_api_key"}');
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.message).toContain('authentication failed');
        expect(err.message).toContain('API key');
        expect(err.context?.status).toBe(401);
        expect(err.context?.hint).toBeTruthy();
    });

    it('returns a ProviderError with hint for 429', () => {
        const err = buildHttpError(429, 'Too Many Requests', 'anthropic', '');
        expect(err.message).toContain('rate limit');
        expect(err.context?.hint).toBeTruthy();
    });

    it('returns generic message for unknown status', () => {
        const err = buildHttpError(418, "I'm a teapot", 'gemini', '');
        expect(err.message).toContain('418');
        expect(err.context?.hint).toBeUndefined();
    });
});

describe('buildConnectionError', () => {
    it('returns a ProviderError with hint for ECONNREFUSED', () => {
        const underlying = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
        const err = buildConnectionError(underlying, 'ollama', 'http://localhost:11434');
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.message).toContain('ollama serve');
        expect(err.context?.hint).toBeTruthy();
    });

    it('falls back to underlying message when no hint matches', () => {
        const underlying = new Error('something weird');
        const err = buildConnectionError(underlying, 'openai', 'https://api.openai.com');
        expect(err.message).toContain('something weird');
    });
});

describe('isRetryableStatus', () => {
    it('returns true for 429', () => expect(isRetryableStatus(429)).toBe(true));
    it('returns true for 500', () => expect(isRetryableStatus(500)).toBe(true));
    it('returns true for 503', () => expect(isRetryableStatus(503)).toBe(true));
    it('returns false for 401', () => expect(isRetryableStatus(401)).toBe(false));
    it('returns false for 404', () => expect(isRetryableStatus(404)).toBe(false));
    it('returns false for 200', () => expect(isRetryableStatus(200)).toBe(false));
});

describe('constants', () => {
    it('PROVIDER_TIMEOUT_MS is 60 seconds', () => expect(PROVIDER_TIMEOUT_MS).toBe(60_000));
    it('OLLAMA_TIMEOUT_MS is 5 minutes', () => expect(OLLAMA_TIMEOUT_MS).toBe(300_000));
});

describe('fetchWithRetry', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.useRealTimers();
    });

    it('returns response on first successful call', async () => {
        const mockResponse = new Response('ok', { status: 200 });
        globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

        const result = await fetchWithRetry(
            'https://api.example.com/test',
            { method: 'POST' },
            { provider: 'test', baseUrl: 'https://api.example.com', timeoutMs: 5000, maxRetries: 2 },
        );

        expect(result.status).toBe(200);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('retries on 429 and succeeds', async () => {
        const retryResponse = new Response('rate limited', { status: 429 });
        const okResponse = new Response('ok', { status: 200 });
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(retryResponse)
            .mockResolvedValueOnce(okResponse);

        // 429 backoff starts at 10s — advance fake timers past it so the test
        // doesn't wait 10 real seconds and hit the default timeout.
        const [result] = await Promise.all([
            fetchWithRetry(
                'https://api.example.com/test',
                { method: 'POST' },
                { provider: 'test', baseUrl: 'https://api.example.com', timeoutMs: 5000, maxRetries: 2 },
            ),
            vi.advanceTimersByTimeAsync(15_000),
        ]);

        expect(result.status).toBe(200);
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('retries on 500 and succeeds', async () => {
        const errorResponse = new Response('server error', { status: 500 });
        const okResponse = new Response('ok', { status: 200 });
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(errorResponse)
            .mockResolvedValueOnce(okResponse);

        const result = await fetchWithRetry(
            'https://api.example.com/test',
            { method: 'POST' },
            { provider: 'test', baseUrl: 'https://api.example.com', timeoutMs: 5000, maxRetries: 2 },
        );

        expect(result.status).toBe(200);
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws ProviderError after exhausting retries on 429', async () => {
        const retryResponse = new Response('rate limited', { status: 429 });
        globalThis.fetch = vi.fn().mockResolvedValue(retryResponse);

        // Advance past the 10s 429 backoff (maxRetries: 1 → 1 retry → 1 sleep of 10s).
        await Promise.all([
            expect(
                fetchWithRetry(
                    'https://api.example.com/test',
                    { method: 'POST' },
                    { provider: 'openai', baseUrl: 'https://api.openai.com', timeoutMs: 5000, maxRetries: 1 },
                ),
            ).rejects.toThrow(ProviderError),
            vi.advanceTimersByTimeAsync(15_000),
        ]);

        expect(globalThis.fetch).toHaveBeenCalledTimes(2); // initial + 1 retry
    });

    it('throws immediately on non-retryable status (401)', async () => {
        const authError = new Response('unauthorized', { status: 401 });
        globalThis.fetch = vi.fn().mockResolvedValue(authError);

        await expect(
            fetchWithRetry(
                'https://api.example.com/test',
                { method: 'POST' },
                { provider: 'openai', baseUrl: 'https://api.openai.com', timeoutMs: 5000, maxRetries: 2 },
            ),
        ).rejects.toThrow(/authentication failed/);

        expect(globalThis.fetch).toHaveBeenCalledTimes(1); // no retries
    });

    it('retries on network error and succeeds', async () => {
        const networkErr = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });
        const okResponse = new Response('ok', { status: 200 });
        globalThis.fetch = vi.fn()
            .mockRejectedValueOnce(networkErr)
            .mockResolvedValueOnce(okResponse);

        const result = await fetchWithRetry(
            'https://api.example.com/test',
            { method: 'POST' },
            { provider: 'test', baseUrl: 'https://api.example.com', timeoutMs: 5000, maxRetries: 2 },
        );

        expect(result.status).toBe(200);
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws connection error after exhausting retries on network error', async () => {
        const networkErr = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
        globalThis.fetch = vi.fn().mockRejectedValue(networkErr);

        await expect(
            fetchWithRetry(
                'http://localhost:11434/api/chat',
                { method: 'POST' },
                { provider: 'ollama', baseUrl: 'http://localhost:11434', timeoutMs: 5000, maxRetries: 1 },
            ),
        ).rejects.toThrow(/ollama serve/);

        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry non-retryable network errors', async () => {
        const err = new Error('something unexpected and unique');
        globalThis.fetch = vi.fn().mockRejectedValue(err);

        await expect(
            fetchWithRetry(
                'https://api.example.com/test',
                { method: 'POST' },
                { provider: 'test', baseUrl: 'https://api.example.com', timeoutMs: 5000, maxRetries: 2 },
            ),
        ).rejects.toThrow(ProviderError);

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
});
