/**
 * Shared error handling utilities for LLM providers.
 *
 * Provides actionable error messages, retry logic, and timeout
 * handling so each provider doesn't duplicate this logic.
 *
 * Dependency direction: provider-errors.ts → core/errors.ts, utils/logger.ts
 * Used by: anthropic.ts, openai.ts, gemini.ts, ollama.ts
 */

import { ProviderError } from '../core/errors.js';
import { logger } from '../utils/logger.js';

/** Default timeout for cloud provider requests (60 seconds). */
export const PROVIDER_TIMEOUT_MS = 60_000;

/** Ollama timeout — local models on CPU can be slow (5 minutes). */
export const OLLAMA_TIMEOUT_MS = 300_000;

/** Get an actionable hint for an HTTP error status code. */
export function getHttpErrorHint(status: number, provider: string): string {
    if (status === 401 || status === 403) {
        return `Check your ${provider} API key in .aiagentflow/config.json — run 'aiagentflow init' to reconfigure`;
    }
    if (status === 404) {
        return 'Check the base URL in your configuration or verify the model name exists';
    }
    if (status === 429) {
        return 'Rate limited — wait a moment and retry, or check your plan\'s rate limits';
    }
    if (status >= 500) {
        return `${provider} is experiencing server issues — retry in a few seconds`;
    }
    return '';
}

/** Classify a network/connection error and return an actionable hint. */
export function getConnectionErrorHint(err: unknown, provider: string, baseUrl: string): string {
    const code = getErrorCode(err);
    const message = err instanceof Error ? err.message : String(err);

    if (code === 'ECONNREFUSED' || message.includes('ECONNREFUSED')) {
        if (provider === 'ollama') {
            return `Cannot reach ${baseUrl} — is Ollama running? Start it with 'ollama serve'`;
        }
        return `Cannot reach ${baseUrl} — is the service running?`;
    }

    if (code === 'ENOTFOUND' || message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
        return `DNS lookup failed for ${baseUrl} — check the URL in .aiagentflow/config.json`;
    }

    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || message.includes('ETIMEDOUT')) {
        return `Connection timed out to ${baseUrl} — check your network or try again`;
    }

    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        return 'Request timed out — the server may be overloaded, try again';
    }

    return '';
}

/** Build a ProviderError with an actionable hint from an HTTP error. */
export function buildHttpError(
    status: number,
    statusText: string,
    provider: string,
    errorBody: string,
): ProviderError {
    const hint = getHttpErrorHint(status, provider);
    const label = getStatusLabel(status);
    const message = hint
        ? `${provider} API ${label} (${status}). ${hint}`
        : `${provider} API error: ${status} ${statusText}`;

    return new ProviderError(message, {
        provider,
        status,
        body: errorBody,
        ...(hint ? { hint } : {}),
    });
}

/** Build a ProviderError with an actionable hint from a connection error. */
export function buildConnectionError(
    err: unknown,
    provider: string,
    baseUrl: string,
): ProviderError {
    const hint = getConnectionErrorHint(err, provider, baseUrl);
    const underlying = err instanceof Error ? err.message : String(err);
    const message = hint
        ? `Failed to connect to ${provider} API. ${hint}`
        : `Failed to connect to ${provider} API: ${underlying}`;

    return new ProviderError(message, {
        provider,
        baseUrl,
        ...(hint ? { hint } : {}),
    });
}

/** Check if an HTTP status code is retryable. */
export function isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

/** Check if a network error is retryable. */
function isRetryableNetworkError(err: unknown): boolean {
    const code = getErrorCode(err);
    const retryableCodes = ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'];
    if (code && retryableCodes.includes(code)) return true;

    if (err instanceof Error) {
        if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
    }
    return false;
}

/** Options for fetchWithRetry. */
export interface FetchRetryOptions {
    provider: string;
    baseUrl: string;
    timeoutMs: number;
    maxRetries?: number;
}

/**
 * Fetch with automatic retry, timeout, and actionable error messages.
 *
 * Retries on 429, 5xx, and transient network errors with exponential backoff.
 * Throws ProviderError with actionable hints on final failure.
 */
export async function fetchWithRetry(
    url: string,
    init: RequestInit,
    options: FetchRetryOptions,
): Promise<Response> {
    const { provider, baseUrl, timeoutMs, maxRetries = 2 } = options;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, {
                ...init,
                signal: AbortSignal.timeout(timeoutMs),
            });

            if (!response.ok) {
                if (isRetryableStatus(response.status) && attempt < maxRetries) {
                    const delay = getRetryDelay(response, attempt);
                    logger.debug(`${provider} returned ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
                    await sleep(delay);
                    continue;
                }

                const errorBody = await response.text();
                throw buildHttpError(response.status, response.statusText, provider, errorBody);
            }

            return response;
        } catch (err) {
            // Re-throw our own errors
            if (err instanceof ProviderError) throw err;

            if (isRetryableNetworkError(err) && attempt < maxRetries) {
                const delay = 1000 * 2 ** attempt; // 1s, 2s, 4s
                logger.debug(`${provider} connection failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
                await sleep(delay);
                continue;
            }

            throw buildConnectionError(err, provider, baseUrl);
        }
    }

    // Unreachable, but satisfies TypeScript
    throw new ProviderError(`${provider} request failed after ${maxRetries + 1} attempts`, { provider });
}

// ── Private helpers ──

function getStatusLabel(status: number): string {
    if (status === 401) return 'authentication failed';
    if (status === 403) return 'access denied';
    if (status === 404) return 'endpoint not found';
    if (status === 429) return 'rate limit exceeded';
    if (status >= 500) return 'server error';
    return 'error';
}

function getErrorCode(err: unknown): string | undefined {
    if (err instanceof Error) {
        // Node.js errors store code on the error itself or on cause
        const nodeErr = err as Error & { code?: string; cause?: { code?: string } };
        return nodeErr.code ?? nodeErr.cause?.code;
    }
    return undefined;
}

function getRetryDelay(response: Response, attempt: number): number {
    // Respect Retry-After header if present
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (!Number.isNaN(seconds) && seconds > 0 && seconds <= 60) {
            return seconds * 1000;
        }
    }
    // Exponential backoff: 1s, 2s, 4s
    return 1000 * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
