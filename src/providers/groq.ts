/**
 * Groq provider adapter.
 *
 * Uses Groq's OpenAI-compatible Chat Completions API directly via fetch().
 * Matches the existing OpenAI adapter flow but uses Groq defaults and paths.
 *
 * Dependency direction: groq.ts → providers/types.ts, core/errors.ts
 * Used by: providers/registry.ts
 */

import { ProviderError } from '../core/errors.js';
import type {
    LLMProvider,
    ChatMessage,
    ChatOptions,
    ChatResponse,
    ChatChunk,
    ModelInfo,
    TokenUsage,
} from './types.js';
import { logger } from '../utils/logger.js';
import { fetchWithRetry, PROVIDER_TIMEOUT_MS } from './provider-errors.js';

/** Configuration required to create a Groq provider. */
export interface GroqProviderConfig {
    readonly apiKey: string;
    readonly baseUrl?: string;
}

/** Default Groq API settings. */
const DEFAULTS = {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    maxTokens: 4096,
} as const;

/**
 * Groq provider implementation.
 *
 * Groq exposes an OpenAI-compatible API surface. The provider uses the
 * official Groq base URL and endpoints so users can configure Groq directly
 * instead of routing it through the OpenAI label.
 */
export class GroqProvider implements LLMProvider {
    public readonly name = 'groq' as const;
    private readonly apiKey: string;
    private readonly baseUrl: string;

    constructor(config: GroqProviderConfig) {
        if (!config.apiKey) {
            throw new ProviderError('Groq API key is required', { provider: 'groq' });
        }
        this.apiKey = config.apiKey;
        this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULTS.baseUrl);
    }

    /**
     * Send a non-streaming chat completion request.
     */
    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
        const apiMessages = this.prepareMessages(messages, options);
        const model = options?.model ?? DEFAULTS.model;

        const body: Record<string, unknown> = {
            model,
            messages: apiMessages,
        };

        if (options?.maxTokens !== undefined) {
            body.max_completion_tokens = options.maxTokens;
        }
        if (options?.temperature !== undefined) {
            body.temperature = options.temperature;
        }
        if (options?.stopSequences?.length) {
            body.stop = options.stopSequences;
        }

        logger.debug(`Groq chat request: model=${model}, messages=${apiMessages.length}`);

        const response = await this.request('/chat/completions', body);

        const choice = (response.choices as Array<Record<string, unknown>>)?.[0];
        const message = choice?.message as Record<string, unknown> | undefined;
        const content = (message?.content as string) ?? '';
        const usage = this.extractUsage(response);

        return {
            content,
            model: (response.model as string) ?? model,
            usage,
            finishReason: (choice?.finish_reason as string) ?? 'unknown',
        };
    }

    /**
     * Send a streaming chat completion request.
     */
    async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk> {
        const apiMessages = this.prepareMessages(messages, options);
        const model = options?.model ?? DEFAULTS.model;

        const body: Record<string, unknown> = {
            model,
            messages: apiMessages,
            stream: true,
        };

        if (options?.maxTokens !== undefined) {
            body.max_completion_tokens = options.maxTokens;
        }
        if (options?.temperature !== undefined) {
            body.temperature = options.temperature;
        }

        const response = await fetchWithRetry(
            `${this.baseUrl}/chat/completions`,
            { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(body) },
            { provider: 'groq', baseUrl: this.baseUrl, timeoutMs: PROVIDER_TIMEOUT_MS },
        );

        if (!response.body) {
            throw new ProviderError('Groq response has no body', { provider: 'groq' });
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') {
                        yield { content: '', done: true };
                        return;
                    }

                    try {
                        const event = JSON.parse(data);
                        const delta = event.choices?.[0]?.delta;
                        if (delta?.content) {
                            yield { content: delta.content, done: false };
                        }
                        // Do NOT exit on finish_reason — compound models (compound-beta,
                        // compound-beta-mini) emit intermediate chunks with finish_reason
                        // set during internal tool-call steps before the final text
                        // response arrives. Let [DONE] be the only termination signal.
                    } catch {
                        // Skip unparseable lines
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        yield { content: '', done: true };
    }

    /**
     * List available models from the Groq API.
     */
    async listModels(): Promise<ModelInfo[]> {
        const response = await fetchWithRetry(
            `${this.baseUrl}/models`,
            { method: 'GET', headers: this.getHeaders() },
            { provider: 'groq', baseUrl: this.baseUrl, timeoutMs: PROVIDER_TIMEOUT_MS },
        );

        const body = await response.json() as { data?: Array<{ id: string }> };
        const models = body.data ?? [];

        return models.map((m) => ({
            id: m.id,
            name: m.id,
            provider: 'groq' as const,
        }));
    }

    /**
     * Validate that the Groq API connection is working.
     */
    async validateConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                method: 'GET',
                headers: this.getHeaders(),
            });

            return response.ok;
        } catch {
            return false;
        }
    }

    private getHeaders(): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
        };
    }

    private async request(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
        const response = await fetchWithRetry(
            `${this.baseUrl}${path}`,
            { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(body) },
            { provider: 'groq', baseUrl: this.baseUrl, timeoutMs: PROVIDER_TIMEOUT_MS },
        );

        return response.json() as Promise<Record<string, unknown>>;
    }

    private prepareMessages(
        messages: ChatMessage[],
        options?: ChatOptions,
    ): Array<{ role: string; content: string }> {
        const apiMessages: Array<{ role: string; content: string }> = [];

        if (options?.systemPrompt) {
            apiMessages.push({ role: 'system', content: options.systemPrompt });
        }

        for (const msg of messages) {
            apiMessages.push({ role: msg.role, content: msg.content });
        }

        return apiMessages;
    }

    private extractUsage(response: Record<string, unknown>): TokenUsage {
        const usage = response.usage as Record<string, number> | undefined;
        return {
            promptTokens: usage?.prompt_tokens ?? 0,
            completionTokens: usage?.completion_tokens ?? 0,
            totalTokens: usage?.total_tokens ?? 0,
        };
    }
}

function normalizeBaseUrl(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/+$/, '');
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}
