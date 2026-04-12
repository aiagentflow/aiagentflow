/**
 * OpenRouter provider adapter.
 *
 * OpenRouter exposes an OpenAI-compatible Chat Completions API that proxies
 * hundreds of models (including many free-tier ones). Useful for testing
 * without hitting per-provider rate limits.
 *
 * Free models: append ":free" to the model ID, e.g. "meta-llama/llama-3.1-8b-instruct:free"
 * Full model list: https://openrouter.ai/models
 *
 * Dependency direction: openrouter.ts → providers/types.ts, core/errors.ts
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

/** Configuration required to create an OpenRouter provider. */
export interface OpenRouterProviderConfig {
    readonly apiKey: string;
    readonly baseUrl?: string;
    /** Shown in OpenRouter usage dashboard and rankings. */
    readonly siteUrl?: string;
    readonly siteName?: string;
}

/** Default OpenRouter API settings. */
const DEFAULTS = {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    maxTokens: 4096,
    siteUrl: 'https://github.com/aiagentflow/aiagentflow',
    siteName: 'aiagentflow',
} as const;

/**
 * OpenRouter provider implementation.
 *
 * Uses the OpenAI-compatible endpoints at openrouter.ai. The only differences
 * from the OpenAI provider are the base URL, optional HTTP-Referer / X-Title
 * headers, and the default model pointing to a free-tier option.
 */
export class OpenRouterProvider implements LLMProvider {
    public readonly name = 'openrouter' as const;
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly siteUrl: string;
    private readonly siteName: string;

    constructor(config: OpenRouterProviderConfig) {
        if (!config.apiKey) {
            throw new ProviderError('OpenRouter API key is required', { provider: 'openrouter' });
        }
        this.apiKey = config.apiKey;
        this.baseUrl = (config.baseUrl ?? DEFAULTS.baseUrl).replace(/\/+$/, '');
        this.siteUrl = config.siteUrl ?? DEFAULTS.siteUrl;
        this.siteName = config.siteName ?? DEFAULTS.siteName;
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
            body.max_tokens = options.maxTokens;
        }
        if (options?.temperature !== undefined) {
            body.temperature = options.temperature;
        }
        if (options?.stopSequences?.length) {
            body.stop = options.stopSequences;
        }

        logger.debug(`OpenRouter chat request: model=${model}, messages=${apiMessages.length}`);

        const response = await fetchWithRetry(
            `${this.baseUrl}/chat/completions`,
            { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(body) },
            { provider: 'openrouter', baseUrl: this.baseUrl, timeoutMs: PROVIDER_TIMEOUT_MS },
        );

        const data = await response.json() as Record<string, unknown>;
        const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
        const message = choice?.message as Record<string, unknown> | undefined;
        const content = (message?.content as string) ?? '';
        const usage = this.extractUsage(data);

        return {
            content,
            model: (data.model as string) ?? model,
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
            body.max_tokens = options.maxTokens;
        }
        if (options?.temperature !== undefined) {
            body.temperature = options.temperature;
        }

        const response = await fetchWithRetry(
            `${this.baseUrl}/chat/completions`,
            { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(body) },
            { provider: 'openrouter', baseUrl: this.baseUrl, timeoutMs: PROVIDER_TIMEOUT_MS },
        );

        if (!response.body) {
            throw new ProviderError('OpenRouter response has no body', { provider: 'openrouter' });
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
     * List available models from OpenRouter (filtered to text generation models).
     */
    async listModels(): Promise<ModelInfo[]> {
        const response = await fetchWithRetry(
            `${this.baseUrl}/models`,
            { method: 'GET', headers: this.getHeaders() },
            { provider: 'openrouter', baseUrl: this.baseUrl, timeoutMs: PROVIDER_TIMEOUT_MS },
        );

        const body = await response.json() as {
            data?: Array<{ id: string; context_length?: number }>;
        };
        const models = body.data ?? [];

        return models.map((m) => ({
            id: m.id,
            name: m.id,
            provider: 'openrouter' as const,
            contextWindow: m.context_length,
        }));
    }

    /**
     * Validate that the OpenRouter API connection is working.
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

    // ── Private helpers ──

    private getHeaders(): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'HTTP-Referer': this.siteUrl,
            'X-Title': this.siteName,
        };
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
