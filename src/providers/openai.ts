/**
 * OpenAI provider adapter.
 *
 * Uses the OpenAI Chat Completions API directly via fetch() — no SDK dependency.
 * Matches the existing pattern established by the Anthropic adapter.
 *
 * Dependency direction: openai.ts → providers/types.ts, core/errors.ts
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

/** Configuration required to create an OpenAI provider. */
export interface OpenAIProviderConfig {
    readonly apiKey: string;
    readonly baseUrl?: string;
    readonly organization?: string;
}

/** Default OpenAI API settings. */
const DEFAULTS = {
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4o-mini',
    maxTokens: 4096,
} as const;

/**
 * OpenAI provider implementation.
 *
 * Implements the LLMProvider interface using the OpenAI Chat Completions API.
 * OpenAI supports `system` role natively in the messages array.
 */
export class OpenAIProvider implements LLMProvider {
    public readonly name = 'openai' as const;
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly organization?: string;

    constructor(config: OpenAIProviderConfig) {
        if (!config.apiKey) {
            throw new ProviderError('OpenAI API key is required', { provider: 'openai' });
        }
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl ?? DEFAULTS.baseUrl;
        this.organization = config.organization;
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

        logger.debug(`OpenAI chat request: model=${model}, messages=${apiMessages.length}`);

        const response = await this.request('/v1/chat/completions', body);

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
            body.max_tokens = options.maxTokens;
        }
        if (options?.temperature !== undefined) {
            body.temperature = options.temperature;
        }

        const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new ProviderError(
                `OpenAI streaming request failed: ${response.status} ${response.statusText}`,
                { status: response.status, body: errorBody, provider: 'openai' },
            );
        }

        if (!response.body) {
            throw new ProviderError('OpenAI response has no body', { provider: 'openai' });
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
                        if (event.choices?.[0]?.finish_reason) {
                            yield { content: '', done: true };
                            return;
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
     * List available models from the OpenAI API.
     */
    async listModels(): Promise<ModelInfo[]> {
        try {
            const response = await fetch(`${this.baseUrl}/v1/models`, {
                method: 'GET',
                headers: this.getHeaders(),
            });

            if (!response.ok) {
                throw new ProviderError(
                    `OpenAI models request failed: ${response.status}`,
                    { provider: 'openai' },
                );
            }

            const body = await response.json() as { data?: Array<{ id: string }> };
            const models = body.data ?? [];

            return models.map((m) => ({
                id: m.id,
                name: m.id,
                provider: 'openai' as const,
            }));
        } catch (err) {
            if (err instanceof ProviderError) throw err;
            throw new ProviderError(
                `Failed to list OpenAI models: ${err instanceof Error ? err.message : String(err)}`,
                { provider: 'openai' },
            );
        }
    }

    /**
     * Validate that the OpenAI API connection is working.
     */
    async validateConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/v1/models`, {
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
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
        };

        if (this.organization) {
            headers['OpenAI-Organization'] = this.organization;
        }

        return headers;
    }

    private async request(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
        let response: Response;

        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(body),
            });
        } catch (err) {
            throw new ProviderError(
                `Failed to connect to OpenAI API: ${err instanceof Error ? err.message : String(err)}`,
                { provider: 'openai', baseUrl: this.baseUrl },
            );
        }

        if (!response.ok) {
            const errorBody = await response.text();
            throw new ProviderError(
                `OpenAI API error: ${response.status} ${response.statusText}`,
                { status: response.status, body: errorBody, provider: 'openai' },
            );
        }

        return response.json() as Promise<Record<string, unknown>>;
    }

    /**
     * Prepare messages for the OpenAI API.
     * OpenAI supports system role natively in the messages array.
     */
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
