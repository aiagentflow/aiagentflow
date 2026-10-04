/**
 * Anthropic Claude provider adapter.
 *
 * Uses the Anthropic Messages API directly via fetch() — no SDK dependency.
 * This gives full control over request/response handling and keeps deps minimal.
 *
 * Dependency direction: anthropic.ts → providers/types.ts, core/errors.ts
 * Used by: providers/registry.ts
 */

import { PROVIDER_DEFAULT_MODELS } from './metadata.js';
import { ProviderError } from '../core/errors.js';
import type {
    LLMProvider,
    ChatMessage,
    ChatOptions,
    ChatResponse,
    ChatChunk,
    ModelInfo,
    TokenUsage,
    ToolDefinition,
    ToolCall,
    StopReason,
} from './types.js';
import { logger } from '../utils/logger.js';
import { fetchWithRetry, PROVIDER_TIMEOUT_MS } from './provider-errors.js';
import { normalizeStopReason } from './messages.js';

/** Configuration required to create an Anthropic provider. */
export interface AnthropicProviderConfig {
    readonly apiKey: string;
    readonly baseUrl?: string;
    readonly apiVersion?: string;
}

/** Default Anthropic API settings. */
const DEFAULTS = {
    baseUrl: 'https://api.anthropic.com',
    apiVersion: '2023-06-01',
    model: PROVIDER_DEFAULT_MODELS.anthropic,
    maxTokens: 4096,
} as const;

/**
 * Anthropic Claude provider implementation.
 *
 * Implements the LLMProvider interface using the Anthropic Messages API.
 * Handles system prompts separately (Anthropic uses a top-level `system` field).
 */
export class AnthropicProvider implements LLMProvider {
    public readonly name = 'anthropic' as const;
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly apiVersion: string;

    constructor(config: AnthropicProviderConfig) {
        if (!config.apiKey) {
            throw new ProviderError('Anthropic API key is required', { provider: 'anthropic' });
        }
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl ?? DEFAULTS.baseUrl;
        this.apiVersion = config.apiVersion ?? DEFAULTS.apiVersion;
    }

    /**
     * Send a non-streaming chat completion request.
     * Tool calls the model requests are returned in `toolCalls`; the caller executes them.
     */
    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
        const model = options?.model ?? DEFAULTS.model;
        const body = this.buildBody(messages, options, model);

        logger.debug(`Anthropic chat request: model=${model}, messages=${messages.length}`);

        const response = await this.request('/v1/messages', body);
        const stopReason = response.stop_reason as string | undefined;

        return {
            content: this.extractContent(response),
            model: (response.model as string | undefined) ?? model,
            usage: this.extractUsage(response),
            finishReason: stopReason ?? 'unknown',
            stopReason: normalizeStopReason(stopReason),
            toolCalls: this.extractToolCalls(response),
        };
    }

    /**
     * Send a streaming chat completion request.
     * Text arrives incrementally; each tool call is emitted once its input JSON is complete.
     */
    async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk> {
        const model = options?.model ?? DEFAULTS.model;
        const body = { ...this.buildBody(messages, options, model), stream: true };

        const response = await fetchWithRetry(
            `${this.baseUrl}/v1/messages`,
            { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(body) },
            { provider: 'anthropic', baseUrl: this.baseUrl, timeoutMs: PROVIDER_TIMEOUT_MS },
        );

        if (!response.body) {
            throw new ProviderError('Anthropic response has no body', { provider: 'anthropic' });
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let stopReason: StopReason | undefined;
        // Input usage arrives in message_start, output usage in message_delta
        let usage: AnthropicUsage = {};
        // Tool-use blocks being streamed, keyed by content block index
        const pendingTools = new Map<number, { id: string; name: string; json: string }>();

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
                        yield { content: '', done: true, stopReason, usage: toUsage(usage) };
                        return;
                    }

                    let event: AnthropicStreamEvent;
                    try {
                        event = JSON.parse(data) as AnthropicStreamEvent;
                    } catch {
                        continue; // Skip unparseable lines
                    }

                    if (event.type === 'message_start' && event.message?.usage) {
                        usage = { ...usage, ...event.message.usage };
                    } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
                        pendingTools.set(event.index ?? -1, { id: event.content_block.id ?? '', name: event.content_block.name ?? '', json: '' });
                    } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
                        const tool = pendingTools.get(event.index ?? -1);
                        if (tool) tool.json += event.delta.partial_json ?? '';
                    } else if (event.type === 'content_block_delta' && event.delta?.text) {
                        yield { content: event.delta.text, done: false };
                    } else if (event.type === 'content_block_stop' && pendingTools.has(event.index ?? -1)) {
                        const tool = pendingTools.get(event.index ?? -1)!;
                        pendingTools.delete(event.index ?? -1);
                        yield { content: '', done: false, toolCalls: [{ callId: tool.id, name: tool.name, input: parseToolInput(tool.json) }] };
                    } else if (event.type === 'message_delta') {
                        if (event.delta?.stop_reason) stopReason = normalizeStopReason(event.delta.stop_reason);
                        if (event.usage) usage = { ...usage, ...event.usage };
                    } else if (event.type === 'message_stop') {
                        yield { content: '', done: true, stopReason, usage: toUsage(usage) };
                        return;
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        yield { content: '', done: true, stopReason, usage: toUsage(usage) };
    }

    private buildBody(messages: ChatMessage[], options: ChatOptions | undefined, model: string): Record<string, unknown> {
        const { systemPrompt, apiMessages } = this.prepareMessages(messages, options);
        const body: Record<string, unknown> = {
            model,
            max_tokens: options?.maxTokens ?? DEFAULTS.maxTokens,
            messages: apiMessages,
        };
        if (systemPrompt) body.system = systemPrompt;
        if (options?.temperature !== undefined && acceptsSamplingParams(model)) body.temperature = options.temperature;
        if (options?.stopSequences?.length) body.stop_sequences = options.stopSequences;
        if (options?.tools?.length) body.tools = this.serializeTools(options.tools);
        return body;
    }

    private serializeTools(tools: readonly ToolDefinition[]): Array<Record<string, unknown>> {
        return tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema,
        }));
    }

    /**
     * List the models this API key can use, from the Models API.
     */
    async listModels(): Promise<ModelInfo[]> {
        const response = await fetchWithRetry(
            `${this.baseUrl}/v1/models?limit=1000`,
            { method: 'GET', headers: this.getHeaders() },
            { provider: 'anthropic', baseUrl: this.baseUrl, timeoutMs: PROVIDER_TIMEOUT_MS },
        );
        const body = await response.json() as { data?: Array<{ id: string; display_name?: string; max_input_tokens?: number }> };
        return (body.data ?? []).map(m => ({
            id: m.id,
            name: m.display_name ?? m.id,
            provider: 'anthropic' as const,
            ...(m.max_input_tokens ? { contextWindow: m.max_input_tokens } : {}),
        }));
    }

    /**
     * Validate that the Anthropic API connection is working (key accepted).
     */
    async validateConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/v1/models?limit=1`, { method: 'GET', headers: this.getHeaders() });
            return response.ok;
        } catch {
            return false;
        }
    }

    // ── Private helpers ──

    private getHeaders(): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': this.apiVersion,
        };
    }

    private async request(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
        const response = await fetchWithRetry(
            `${this.baseUrl}${path}`,
            { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(body) },
            { provider: 'anthropic', baseUrl: this.baseUrl, timeoutMs: PROVIDER_TIMEOUT_MS },
        );

        return response.json() as Promise<Record<string, unknown>>;
    }

    /**
     * Convert messages to the Anthropic format.
     * System messages move to the top-level `system` field; tool calls and
     * results become `tool_use` / `tool_result` content blocks.
     */
    private prepareMessages(
        messages: ChatMessage[],
        options?: ChatOptions,
    ): { systemPrompt: string | undefined; apiMessages: Array<Record<string, unknown>> } {
        let systemPrompt = options?.systemPrompt;
        const apiMessages: Array<Record<string, unknown>> = [];

        for (const msg of messages) {
            switch (msg.role) {
                case 'system':
                    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
                    break;
                case 'user':
                    apiMessages.push({ role: 'user', content: msg.content });
                    break;
                case 'assistant': {
                    if (!msg.toolCalls?.length) {
                        apiMessages.push({ role: 'assistant', content: msg.content });
                        break;
                    }
                    const blocks: Array<Record<string, unknown>> = [];
                    if (msg.content) blocks.push({ type: 'text', text: msg.content });
                    for (const call of msg.toolCalls) {
                        blocks.push({ type: 'tool_use', id: call.callId, name: call.name, input: call.input });
                    }
                    apiMessages.push({ role: 'assistant', content: blocks });
                    break;
                }
                case 'tool':
                    apiMessages.push({
                        role: 'user',
                        content: msg.results.map(r => ({
                            type: 'tool_result',
                            tool_use_id: r.callId,
                            content: r.content,
                            ...(r.isError ? { is_error: true } : {}),
                        })),
                    });
                    break;
            }
        }

        return { systemPrompt, apiMessages };
    }

    private extractToolCalls(response: Record<string, unknown>): ToolCall[] {
        const content = response.content;
        if (!Array.isArray(content)) return [];
        return content
            .filter((block: Record<string, unknown>) => block.type === 'tool_use')
            .map((block: Record<string, unknown>) => ({
                callId: block.id as string,
                name: block.name as string,
                input: (block.input as Record<string, unknown>) ?? {},
            }));
    }

    private extractContent(response: Record<string, unknown>): string {
        const content = response.content;
        if (Array.isArray(content)) {
            return content
                .filter((block: Record<string, unknown>) => block.type === 'text')
                .map((block: Record<string, unknown>) => block.text as string)
                .join('');
        }
        return String(content ?? '');
    }

    private extractUsage(response: Record<string, unknown>): TokenUsage {
        return toUsage(response.usage as AnthropicUsage | undefined);
    }
}

/** Usage counters as Anthropic reports them. input_tokens excludes cached tokens. */
interface AnthropicUsage {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
}

/** Normalize Anthropic usage so promptTokens counts all input, cached or not. */
function toUsage(usage: AnthropicUsage | undefined): TokenUsage {
    const cacheRead = usage?.cache_read_input_tokens ?? 0;
    const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
    const promptTokens = (usage?.input_tokens ?? 0) + cacheRead + cacheWrite;
    const completionTokens = usage?.output_tokens ?? 0;
    return {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
        ...(cacheWrite ? { cacheWriteTokens: cacheWrite } : {}),
    };
}

/** The subset of Anthropic SSE event fields this adapter reads. */
interface AnthropicStreamEvent {
    type: string;
    index?: number;
    message?: { usage?: AnthropicUsage };
    usage?: AnthropicUsage;
    content_block?: { type: string; id?: string; name?: string };
    delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
}

/** Parse streamed tool input JSON; an empty or malformed payload becomes `{}`. */
function parseToolInput(json: string): Record<string, unknown> {
    if (!json.trim()) return {};
    try {
        const parsed: unknown = JSON.parse(json);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/**
 * Whether a model accepts temperature/top_p/top_k. Current Claude models
 * (Opus 4.7 and later, Sonnet 5 and later, Fable, Mythos) reject non-default
 * sampling parameters with a 400; older models accept them.
 */
export function acceptsSamplingParams(model: string): boolean {
    return /^claude-(3[-.]|haiku-|sonnet-4|opus-4-(?:[0-6](?!\d)|\d{8}))/.test(model);
}
