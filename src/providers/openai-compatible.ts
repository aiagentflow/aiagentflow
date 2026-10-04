/**
 * Shared adapter for OpenAI-compatible Chat Completions APIs.
 *
 * OpenAI, Groq, OpenRouter, and Ollama (via its /v1 endpoint) all speak the
 * same wire format, including function calling. Subclasses supply only what
 * differs: base URL, auth headers, default model, and small quirks.
 *
 * Dependency direction: openai-compatible.ts → providers/types.ts, provider-errors.ts, messages.ts
 * Used by: openai.ts, groq.ts, openrouter.ts, ollama.ts
 */

import { ProviderError } from '../core/errors.js';
import type {
    LLMProvider,
    LLMProviderName,
    ChatMessage,
    ChatOptions,
    ChatResponse,
    ChatChunk,
    ModelInfo,
    TokenUsage,
    ToolCall,
    ToolDefinition,
} from './types.js';
import { logger } from '../utils/logger.js';
import { fetchWithRetry } from './provider-errors.js';
import { normalizeStopReason } from './messages.js';

/** Static settings that describe one OpenAI-compatible endpoint. */
export interface OpenAICompatibleSettings {
    /** Provider identifier. */
    readonly name: LLMProviderName;
    /** Human-readable name for logs and errors (e.g. "OpenAI"). */
    readonly label: string;
    /** Base URL including the version segment, without trailing slash (e.g. https://api.openai.com/v1). */
    readonly baseUrl: string;
    /** Model used when ChatOptions.model is not set. */
    readonly defaultModel: string;
    /** Extra headers sent with every request (auth, attribution). */
    readonly headers: Record<string, string>;
    /** Request timeout in milliseconds. */
    readonly timeoutMs: number;
    /** Body field for the output token limit (newer APIs use max_completion_tokens). */
    readonly maxTokensField?: 'max_tokens' | 'max_completion_tokens';
}

/** OpenAI wire format for a message. */
type ApiMessage =
    | { role: 'system' | 'user'; content: string }
    | { role: 'assistant'; content: string | null; tool_calls?: ApiToolCall[] }
    | { role: 'tool'; tool_call_id: string; content: string };

interface ApiToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

/** The subset of a streamed chunk this adapter reads. */
interface StreamEvent {
    choices?: Array<{
        delta?: {
            content?: string | null;
            tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
        };
        finish_reason?: string | null;
    }>;
    usage?: ApiUsage | null;
    /** Groq reports stream usage here. */
    x_groq?: { usage?: ApiUsage };
}

/** Usage counters in the Chat Completions format. prompt_tokens includes cached tokens. */
interface ApiUsage {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
}

/**
 * Base class for OpenAI-compatible providers.
 */
export abstract class OpenAICompatibleProvider implements LLMProvider {
    public abstract readonly name: LLMProviderName;
    protected readonly settings: OpenAICompatibleSettings;

    protected constructor(settings: OpenAICompatibleSettings) {
        this.settings = { ...settings, baseUrl: settings.baseUrl.replace(/\/+$/, '') };
    }

    /** Hook for provider-specific warnings before a request (e.g. model caveats). */
    protected beforeRequest(_model: string): void {
        // No-op by default
    }

    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
        const model = options?.model ?? this.settings.defaultModel;
        const body = this.buildBody(messages, options, model);
        this.beforeRequest(model);

        logger.debug(`${this.settings.label} chat request: model=${model}, messages=${messages.length}`);

        const response = await this.post('/chat/completions', body);
        const json = await response.json() as Record<string, unknown>;

        const choice = (json.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const message = choice?.message as { content?: string | null; tool_calls?: ApiToolCall[] } | undefined;
        const finishReason = (choice?.finish_reason as string | undefined) ?? 'unknown';

        return {
            content: message?.content ?? '',
            model: (json.model as string | undefined) ?? model,
            usage: extractUsage(json),
            finishReason,
            stopReason: normalizeStopReason(finishReason),
            toolCalls: (message?.tool_calls ?? []).map(parseToolCall),
        };
    }

    async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk> {
        const model = options?.model ?? this.settings.defaultModel;
        // include_usage adds a final chunk with token counts
        const body = { ...this.buildBody(messages, options, model), stream: true, stream_options: { include_usage: true } };
        this.beforeRequest(model);

        const response = await this.post('/chat/completions', body);
        if (!response.body) {
            throw new ProviderError(`${this.settings.label} response has no body`, { provider: this.name });
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finishReason: string | undefined;
        let usage: TokenUsage | undefined;
        // Tool calls arrive as fragments keyed by index; arguments stream as partial JSON
        const pending = new Map<number, { id: string; name: string; args: string }>();

        const flushTools = (): ChatChunk | undefined => {
            if (pending.size === 0) return undefined;
            const toolCalls = [...pending.entries()]
                .sort(([a], [b]) => a - b)
                .map(([, t]) => parseToolCall({ id: t.id, type: 'function', function: { name: t.name, arguments: t.args } }));
            pending.clear();
            return { content: '', done: false, toolCalls };
        };

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
                        const tools = flushTools();
                        if (tools) yield tools;
                        yield { content: '', done: true, stopReason: normalizeStopReason(finishReason), ...(usage ? { usage } : {}) };
                        return;
                    }

                    let event: StreamEvent;
                    try {
                        event = JSON.parse(data) as StreamEvent;
                    } catch {
                        continue; // Skip unparseable lines
                    }

                    const reported = event.usage ?? event.x_groq?.usage;
                    if (reported) usage = toUsage(reported);

                    const choice = event.choices?.[0];
                    const delta = choice?.delta;
                    if (delta?.content) {
                        yield { content: delta.content, done: false };
                    }
                    for (const frag of delta?.tool_calls ?? []) {
                        const entry = pending.get(frag.index) ?? { id: '', name: '', args: '' };
                        if (frag.id) entry.id = frag.id;
                        if (frag.function?.name) entry.name += frag.function.name;
                        if (frag.function?.arguments) entry.args += frag.function.arguments;
                        pending.set(frag.index, entry);
                    }
                    // Do not stop on finish_reason: some models (e.g. Groq compound) emit it on
                    // intermediate chunks. [DONE] or end of body is the only termination signal.
                    if (choice?.finish_reason) {
                        finishReason = choice.finish_reason;
                        const tools = flushTools();
                        if (tools) yield tools;
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        const tools = flushTools();
        if (tools) yield tools;
        yield { content: '', done: true, stopReason: normalizeStopReason(finishReason), ...(usage ? { usage } : {}) };
    }

    async listModels(): Promise<ModelInfo[]> {
        const response = await fetchWithRetry(
            `${this.settings.baseUrl}/models`,
            { method: 'GET', headers: this.getHeaders() },
            { provider: this.name, baseUrl: this.settings.baseUrl, timeoutMs: this.settings.timeoutMs },
        );

        const body = await response.json() as { data?: Array<{ id: string; context_length?: number }> };
        return (body.data ?? []).map(m => ({
            id: m.id,
            name: m.id,
            provider: this.name,
            ...(m.context_length ? { contextWindow: m.context_length } : {}),
        }));
    }

    async validateConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${this.settings.baseUrl}/models`, { method: 'GET', headers: this.getHeaders() });
            return response.ok;
        } catch {
            return false;
        }
    }

    // ── Helpers ──

    protected getHeaders(): Record<string, string> {
        return { 'Content-Type': 'application/json', ...this.settings.headers };
    }

    private async post(path: string, body: Record<string, unknown>): Promise<Response> {
        return fetchWithRetry(
            `${this.settings.baseUrl}${path}`,
            { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(body) },
            { provider: this.name, baseUrl: this.settings.baseUrl, timeoutMs: this.settings.timeoutMs },
        );
    }

    private buildBody(messages: ChatMessage[], options: ChatOptions | undefined, model: string): Record<string, unknown> {
        const body: Record<string, unknown> = { model, messages: toApiMessages(messages, options?.systemPrompt) };
        if (options?.maxTokens !== undefined) body[this.settings.maxTokensField ?? 'max_tokens'] = options.maxTokens;
        if (options?.temperature !== undefined) body.temperature = options.temperature;
        if (options?.stopSequences?.length) body.stop = options.stopSequences;
        if (options?.tools?.length) body.tools = options.tools.map(serializeTool);
        return body;
    }
}

/** Convert provider-agnostic messages to the OpenAI wire format. */
export function toApiMessages(messages: readonly ChatMessage[], systemPrompt?: string): ApiMessage[] {
    const out: ApiMessage[] = [];
    if (systemPrompt) out.push({ role: 'system', content: systemPrompt });

    for (const msg of messages) {
        switch (msg.role) {
            case 'system':
            case 'user':
                out.push({ role: msg.role, content: msg.content });
                break;
            case 'assistant':
                if (msg.toolCalls?.length) {
                    out.push({
                        role: 'assistant',
                        content: msg.content || null,
                        tool_calls: msg.toolCalls.map(c => ({
                            id: c.callId,
                            type: 'function',
                            function: { name: c.name, arguments: JSON.stringify(c.input) },
                        })),
                    });
                } else {
                    out.push({ role: 'assistant', content: msg.content });
                }
                break;
            case 'tool':
                // One message per result; the format has no error flag, so mark it in the text
                for (const r of msg.results) {
                    out.push({ role: 'tool', tool_call_id: r.callId, content: r.isError ? `Error: ${r.content}` : r.content });
                }
                break;
        }
    }
    return out;
}

function serializeTool(tool: ToolDefinition): Record<string, unknown> {
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } };
}

function parseToolCall(call: ApiToolCall): ToolCall {
    let input: Record<string, unknown> = {};
    try {
        const parsed: unknown = JSON.parse(call.function.arguments || '{}');
        if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>;
    } catch {
        logger.debug(`Could not parse arguments for tool call ${call.function.name}`);
    }
    return { callId: call.id, name: call.function.name, input };
}

function extractUsage(json: Record<string, unknown>): TokenUsage {
    return toUsage(json.usage as ApiUsage | undefined);
}

function toUsage(usage: ApiUsage | undefined): TokenUsage {
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    const cacheRead = usage?.prompt_tokens_details?.cached_tokens ?? 0;
    return {
        promptTokens,
        completionTokens,
        totalTokens: usage?.total_tokens ?? promptTokens + completionTokens,
        ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
    };
}

/** Append `/v1` unless the URL already ends with it. */
export function withV1(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/+$/, '');
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}
