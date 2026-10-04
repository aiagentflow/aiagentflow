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
    ToolCall,
} from './types.js';
import { logger } from '../utils/logger.js';
import { fetchWithRetry, PROVIDER_TIMEOUT_MS } from './provider-errors.js';
import { normalizeStopReason } from './messages.js';

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
        const body = this.buildBody(messages, options);

        logger.debug(`Gemini chat request: model=${model}, contents=${(body.contents as unknown[]).length}`);

        const response = await this.request(
            `/v1beta/models/${model}:generateContent`,
            body,
        );

        const candidates = response.candidates as Array<Record<string, unknown>> | undefined;
        const firstCandidate = candidates?.[0];
        const content = firstCandidate?.content as Record<string, unknown> | undefined;
        const parts = (content?.parts as GeminiPart[] | undefined) ?? [];
        const text = parts.map((p) => p.text ?? '').join('');
        const toolCalls = extractToolCalls(parts);
        const finishReason = (firstCandidate?.finishReason as string) ?? 'unknown';
        const usage = this.extractUsage(response);

        return {
            content: text,
            model,
            usage,
            finishReason,
            // Gemini reports STOP even when it requests functions
            stopReason: toolCalls.length > 0 ? 'tool_use' : normalizeStopReason(finishReason),
            toolCalls,
        };
    }

    /**
     * Send a streaming chat completion request.
     */
    async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk> {
        const model = options?.model ?? DEFAULTS.model;
        const body = this.buildBody(messages, options);

        const url = `${this.baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

        const response = await fetchWithRetry(
            url,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
            { provider: 'gemini', baseUrl: this.baseUrl, timeoutMs: PROVIDER_TIMEOUT_MS },
        );

        if (!response.body) {
            throw new ProviderError('Gemini response has no body', { provider: 'gemini' });
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let sawToolCall = false;
        let callIndex = 0;
        // usageMetadata is cumulative; the last one seen covers the whole response
        let usage: TokenUsage | undefined;

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

                    let event: {
                        candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
                        usageMetadata?: GeminiUsage;
                    };
                    try {
                        event = JSON.parse(data);
                    } catch {
                        continue; // Skip unparseable lines
                    }

                    if (event.usageMetadata) usage = toUsage(event.usageMetadata);

                    const candidate = event.candidates?.[0];
                    const parts = candidate?.content?.parts ?? [];
                    const text = parts.map((p) => p.text ?? '').join('');
                    if (text) {
                        yield { content: text, done: false };
                    }

                    // Function calls arrive whole, never split across chunks
                    const toolCalls = extractToolCalls(parts, callIndex);
                    if (toolCalls.length > 0) {
                        callIndex += toolCalls.length;
                        sawToolCall = true;
                        yield { content: '', done: false, toolCalls };
                    }

                    if (candidate?.finishReason) {
                        const stopReason = sawToolCall ? 'tool_use' : normalizeStopReason(candidate.finishReason);
                        yield { content: '', done: true, stopReason, ...(usage ? { usage } : {}) };
                        return;
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        yield { content: '', done: true, ...(usage ? { usage } : {}) };
    }

    /**
     * List available models from the Gemini API.
     */
    async listModels(): Promise<ModelInfo[]> {
        const url = `${this.baseUrl}/v1beta/models?key=${this.apiKey}`;
        const response = await fetchWithRetry(
            url,
            { method: 'GET' },
            { provider: 'gemini', baseUrl: this.baseUrl, timeoutMs: PROVIDER_TIMEOUT_MS },
        );

        const body = await response.json() as { models?: Array<{ name: string; displayName?: string }> };
        const models = body.models ?? [];

        return models.map((m) => ({
            id: m.name.replace(/^models\//, ''),
            name: m.displayName ?? m.name.replace(/^models\//, ''),
            provider: 'gemini' as const,
        }));
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
        const response = await fetchWithRetry(
            url,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
            { provider: 'gemini', baseUrl: this.baseUrl, timeoutMs: PROVIDER_TIMEOUT_MS },
        );

        return response.json() as Promise<Record<string, unknown>>;
    }

    private buildBody(messages: ChatMessage[], options?: ChatOptions): Record<string, unknown> {
        const { contents, systemInstruction } = prepareContents(messages, options?.systemPrompt);
        const body: Record<string, unknown> = { contents };

        if (systemInstruction) body.system_instruction = systemInstruction;
        if (options?.tools?.length) {
            body.tools = [{
                functionDeclarations: options.tools.map(t => ({
                    name: t.name,
                    description: t.description,
                    parameters: toGeminiSchema(t.inputSchema),
                })),
            }];
        }

        const generationConfig: Record<string, unknown> = {};
        if (options?.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens;
        if (options?.temperature !== undefined) generationConfig.temperature = options.temperature;
        if (options?.stopSequences?.length) generationConfig.stopSequences = options.stopSequences;
        if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

        return body;
    }

    private extractUsage(response: Record<string, unknown>): TokenUsage {
        return toUsage(response.usageMetadata as GeminiUsage | undefined);
    }
}

/** Usage counters as Gemini reports them. promptTokenCount includes cached content. */
interface GeminiUsage {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
}

function toUsage(usage: GeminiUsage | undefined): TokenUsage {
    const promptTokens = usage?.promptTokenCount ?? 0;
    // Thinking tokens are billed as output
    const completionTokens = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
    const cacheRead = usage?.cachedContentTokenCount ?? 0;
    return {
        promptTokens,
        completionTokens,
        totalTokens: usage?.totalTokenCount ?? promptTokens + completionTokens,
        ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
    };
}

/** A content part in the Gemini wire format. */
interface GeminiPart {
    text?: string;
    functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
    thoughtSignature?: string;
}

/**
 * Convert messages to Gemini `contents`.
 * Gemini uses `user` and `model` roles; system text goes to `system_instruction`.
 * Function responses are matched to their call by name, so tool results look up
 * the name of the call they answer.
 */
export function prepareContents(
    messages: readonly ChatMessage[],
    systemPrompt?: string,
): { contents: Array<{ role: 'user' | 'model'; parts: GeminiPart[] }>; systemInstruction?: { parts: Array<{ text: string }> } } {
    const contents: Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> = [];
    const systemParts: string[] = systemPrompt ? [systemPrompt] : [];
    const callsById = new Map<string, ToolCall>();

    for (const msg of messages) {
        switch (msg.role) {
            case 'system':
                systemParts.push(msg.content);
                break;
            case 'user':
                contents.push({ role: 'user', parts: [{ text: msg.content }] });
                break;
            case 'assistant': {
                const parts: GeminiPart[] = msg.content ? [{ text: msg.content }] : [];
                for (const call of msg.toolCalls ?? []) {
                    callsById.set(call.callId, call);
                    const signature = call.metadata?.thoughtSignature;
                    parts.push({
                        functionCall: { name: call.name, args: call.input },
                        ...(typeof signature === 'string' ? { thoughtSignature: signature } : {}),
                    });
                }
                contents.push({ role: 'model', parts });
                break;
            }
            case 'tool':
                contents.push({
                    role: 'user',
                    parts: msg.results.map(r => ({
                        functionResponse: {
                            name: callsById.get(r.callId)?.name ?? r.callId,
                            response: r.isError ? { error: r.content } : { content: r.content },
                        },
                    })),
                });
                break;
        }
    }

    const systemInstruction = systemParts.length > 0 ? { parts: [{ text: systemParts.join('\n\n') }] } : undefined;
    return { contents, systemInstruction };
}

/** Pull function calls out of response parts. Gemini may omit ids, so generate stable ones. */
function extractToolCalls(parts: readonly GeminiPart[], startIndex = 0): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const part of parts) {
        if (!part.functionCall) continue;
        calls.push({
            callId: part.functionCall.id ?? `gemini_call_${startIndex + calls.length}`,
            name: part.functionCall.name,
            input: part.functionCall.args ?? {},
            ...(part.thoughtSignature ? { metadata: { thoughtSignature: part.thoughtSignature } } : {}),
        });
    }
    return calls;
}

/** JSON Schema keywords Gemini's OpenAPI-subset schema rejects. */
const UNSUPPORTED_SCHEMA_KEYS = new Set(['$schema', '$id', 'additionalProperties', 'default', 'examples']);

/** Strip JSON Schema keywords that Gemini function declarations do not accept. */
export function toGeminiSchema(schema: unknown): unknown {
    if (Array.isArray(schema)) return schema.map(toGeminiSchema);
    if (!schema || typeof schema !== 'object') return schema;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
        if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
        // `properties` maps names to schemas; keep the names, clean the schemas
        out[key] = key === 'properties' && value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toGeminiSchema(v)]))
            : toGeminiSchema(value);
    }
    return out;
}
