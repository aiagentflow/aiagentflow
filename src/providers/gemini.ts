/**
 * Google Gemini provider adapter.
 *
 * Uses the Gemini REST API directly via fetch() — no SDK dependency.
 * API key is passed as a query parameter (not in headers).
 *
 * Dependency direction: gemini.ts → providers/types.ts, core/errors.ts
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

/** Configuration required to create a Gemini provider. */
export interface GeminiProviderConfig {
    readonly apiKey: string;
    readonly baseUrl?: string;
}

/** Default Gemini API settings. */
const DEFAULTS = {
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.0-flash',
    maxTokens: 4096,
} as const;

/**
 * Google Gemini provider implementation.
 *
 * Implements the LLMProvider interface using the Gemini generateContent API.
 * System instructions are extracted from messages and sent via a dedicated field.
 * API key is sent as a query parameter — URLs are not logged to avoid key leaks.
 */
export class GeminiProvider implements LLMProvider {
    public readonly name = 'gemini' as const;
    private readonly apiKey: string;
    private readonly baseUrl: string;

    constructor(config: GeminiProviderConfig) {
        if (!config.apiKey) {
            throw new ProviderError('Gemini API key is required', { provider: 'gemini' });
        }
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl ?? DEFAULTS.baseUrl;
    }

    /**
     * Send a non-streaming chat completion request.
     */
    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
        const model = options?.model ?? DEFAULTS.model;
        const { contents, systemInstruction } = this.prepareMessages(messages, options);

        const body: Record<string, unknown> = { contents };

        if (systemInstruction) {
            body.system_instruction = systemInstruction;
        }

        const generationConfig: Record<string, unknown> = {};
        if (options?.maxTokens !== undefined) {
            generationConfig.maxOutputTokens = options.maxTokens;
        }
        if (options?.temperature !== undefined) {
            generationConfig.temperature = options.temperature;
        }
        if (options?.stopSequences?.length) {
            generationConfig.stopSequences = options.stopSequences;
        }
        if (Object.keys(generationConfig).length > 0) {
            body.generationConfig = generationConfig;
        }

        logger.debug(`Gemini chat request: model=${model}, contents=${contents.length}`);

        const response = await this.request(
            `/v1beta/models/${model}:generateContent`,
            body,
        );

        const candidates = response.candidates as Array<Record<string, unknown>> | undefined;
        const firstCandidate = candidates?.[0];
        const content = firstCandidate?.content as Record<string, unknown> | undefined;
        const parts = content?.parts as Array<{ text?: string }> | undefined;
        const text = parts?.map((p) => p.text ?? '').join('') ?? '';
        const finishReason = (firstCandidate?.finishReason as string) ?? 'unknown';
        const usage = this.extractUsage(response);

        return {
            content: text,
            model,
            usage,
            finishReason,
        };
    }

    /**
     * Send a streaming chat completion request.
     */
    async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk> {
        const model = options?.model ?? DEFAULTS.model;
        const { contents, systemInstruction } = this.prepareMessages(messages, options);

        const body: Record<string, unknown> = { contents };

        if (systemInstruction) {
            body.system_instruction = systemInstruction;
        }

        const generationConfig: Record<string, unknown> = {};
        if (options?.maxTokens !== undefined) {
            generationConfig.maxOutputTokens = options.maxTokens;
        }
        if (options?.temperature !== undefined) {
            generationConfig.temperature = options.temperature;
        }
        if (Object.keys(generationConfig).length > 0) {
            body.generationConfig = generationConfig;
        }

        const url = `${this.baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new ProviderError(
                `Gemini streaming request failed: ${response.status} ${response.statusText}`,
                { status: response.status, body: errorBody, provider: 'gemini' },
            );
        }

        if (!response.body) {
            throw new ProviderError('Gemini response has no body', { provider: 'gemini' });
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
                    if (!data) continue;

                    try {
                        const event = JSON.parse(data);
                        const candidates = event.candidates as Array<Record<string, unknown>> | undefined;
                        const parts = (candidates?.[0]?.content as Record<string, unknown>)?.parts as Array<{ text?: string }> | undefined;
                        const text = parts?.map((p) => p.text ?? '').join('') ?? '';

                        if (text) {
                            yield { content: text, done: false };
                        }

                        const finishReason = candidates?.[0]?.finishReason as string | undefined;
                        if (finishReason && finishReason !== 'STOP') {
                            yield { content: '', done: true };
                            return;
                        }
                        if (finishReason === 'STOP') {
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
     * List available models from the Gemini API.
     */
    async listModels(): Promise<ModelInfo[]> {
        try {
            const url = `${this.baseUrl}/v1beta/models?key=${this.apiKey}`;
            const response = await fetch(url, { method: 'GET' });

            if (!response.ok) {
                throw new ProviderError(
                    `Gemini models request failed: ${response.status}`,
                    { provider: 'gemini' },
                );
            }

            const body = await response.json() as { models?: Array<{ name: string; displayName?: string }> };
            const models = body.models ?? [];

            return models.map((m) => ({
                id: m.name.replace(/^models\//, ''),
                name: m.displayName ?? m.name.replace(/^models\//, ''),
                provider: 'gemini' as const,
            }));
        } catch (err) {
            if (err instanceof ProviderError) throw err;
            throw new ProviderError(
                `Failed to list Gemini models: ${err instanceof Error ? err.message : String(err)}`,
                { provider: 'gemini' },
            );
        }
    }

    /**
     * Validate that the Gemini API connection is working.
     */
    async validateConnection(): Promise<boolean> {
        try {
            const url = `${this.baseUrl}/v1beta/models?key=${this.apiKey}`;
            const response = await fetch(url, { method: 'GET' });
            return response.ok;
        } catch {
            return false;
        }
    }

    // -- Private helpers --

    /**
     * Build the URL for an API request, appending the API key as a query parameter.
     * Never log the full URL to avoid leaking the API key.
     */
    private buildUrl(path: string): string {
        return `${this.baseUrl}${path}?key=${this.apiKey}`;
    }

    private async request(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
        const url = this.buildUrl(path);
        let response: Response;

        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch (err) {
            throw new ProviderError(
                `Failed to connect to Gemini API: ${err instanceof Error ? err.message : String(err)}`,
                { provider: 'gemini', baseUrl: this.baseUrl },
            );
        }

        if (!response.ok) {
            const errorBody = await response.text();
            throw new ProviderError(
                `Gemini API error: ${response.status} ${response.statusText}`,
                { status: response.status, body: errorBody, provider: 'gemini' },
            );
        }

        return response.json() as Promise<Record<string, unknown>>;
    }

    /**
     * Prepare messages for the Gemini API.
     * Gemini uses `user` and `model` roles (not `assistant`).
     * System messages are extracted to a separate `system_instruction` field.
     */
    private prepareMessages(
        messages: ChatMessage[],
        options?: ChatOptions,
    ): {
        contents: Array<{ role: string; parts: Array<{ text: string }> }>;
        systemInstruction?: { parts: Array<{ text: string }> };
    } {
        const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
        const systemParts: string[] = [];

        if (options?.systemPrompt) {
            systemParts.push(options.systemPrompt);
        }

        for (const msg of messages) {
            if (msg.role === 'system') {
                systemParts.push(msg.content);
                continue;
            }

            const role = msg.role === 'assistant' ? 'model' : 'user';
            contents.push({
                role,
                parts: [{ text: msg.content }],
            });
        }

        const systemInstruction = systemParts.length > 0
            ? { parts: [{ text: systemParts.join('\n\n') }] }
            : undefined;

        return { contents, systemInstruction };
    }

    private extractUsage(response: Record<string, unknown>): TokenUsage {
        const usage = response.usageMetadata as Record<string, number> | undefined;
        return {
            promptTokens: usage?.promptTokenCount ?? 0,
            completionTokens: usage?.candidatesTokenCount ?? 0,
            totalTokens: usage?.totalTokenCount ?? 0,
        };
    }
}
