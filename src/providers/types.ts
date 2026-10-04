/**
 * LLM Provider interface contract.
 *
 * Every provider adapter (Anthropic, Ollama, future OpenAI, etc.)
 * MUST implement the LLMProvider interface. This ensures consumers
 * never depend on provider-specific details.
 *
 * Dependency direction: providers/types.ts → nothing (leaf module)
 * Used by: all provider implementations, registry, agents, workflow engine
 */

/** Supported LLM provider names. Add new providers here. */
export type LLMProviderName = 'anthropic' | 'gemini' | 'groq' | 'ollama' | 'openai' | 'openrouter';

/** Role in a chat conversation. */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** A plain text message from the system or the user. */
export interface TextMessage {
    readonly role: 'system' | 'user';
    readonly content: string;
}

/** A model turn: text, and optionally the tool calls it requested. */
export interface AssistantMessage {
    readonly role: 'assistant';
    readonly content: string;
    readonly toolCalls?: readonly ToolCall[];
}

/** Results of the tool calls requested by the preceding assistant message. */
export interface ToolResultMessage {
    readonly role: 'tool';
    readonly results: readonly ToolResult[];
}

/** A single message in a chat conversation. */
export type ChatMessage = TextMessage | AssistantMessage | ToolResultMessage;

/** Provider-agnostic tool definition (maps to Anthropic tool / OpenAI function). */
export interface ToolDefinition {
    /** Unique tool name (snake_case). */
    readonly name: string;
    /** Human-readable description passed to the model. */
    readonly description: string;
    /** JSON Schema object describing the tool's input parameters. */
    readonly inputSchema: Record<string, unknown>;
}

/** A tool call the model wants to make. */
export interface ToolCall {
    /** The tool name to invoke. */
    readonly name: string;
    /** The input arguments as parsed JSON. */
    readonly input: Record<string, unknown>;
    /** Provider-internal call ID (needed to send the result back). */
    readonly callId: string;
}

/** The result of executing a tool call. */
export interface ToolResult {
    /** The call ID this result is responding to. */
    readonly callId: string;
    /** The tool's output as a string. */
    readonly content: string;
    /** Whether the tool call succeeded. */
    readonly isError?: boolean;
}

/** Options for a chat completion request. */
export interface ChatOptions {
    /** Model to use (overrides default from config). */
    readonly model?: string;
    /** Sampling temperature (0.0 - 2.0). */
    readonly temperature?: number;
    /** Maximum tokens in the response. */
    readonly maxTokens?: number;
    /** Stop sequences to halt generation. */
    readonly stopSequences?: readonly string[];
    /** System prompt (some providers handle this separately). */
    readonly systemPrompt?: string;
    /** Tools the model may call. Providers return requested calls; they never execute them. */
    readonly tools?: readonly ToolDefinition[];
}

/**
 * Provider-agnostic reason the model stopped.
 * - `end_turn`: the model finished its answer
 * - `tool_use`: the model is waiting for tool results
 * - `max_tokens`: output was cut off by the token limit
 * - `other`: anything else (content filter, provider-specific reasons)
 */
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'other';

/** Response from a non-streaming chat completion. */
export interface ChatResponse {
    /** The generated text content. */
    readonly content: string;
    /** The model that was used. */
    readonly model: string;
    /** Token usage statistics. */
    readonly usage: TokenUsage;
    /** Provider-specific finish reason, as returned by the API. */
    readonly finishReason: string;
    /** Normalized stop reason. */
    readonly stopReason: StopReason;
    /** Tool calls the model requested. Empty when it produced a final answer. */
    readonly toolCalls: readonly ToolCall[];
}

/** A single chunk in a streaming response. */
export interface ChatChunk {
    /** Incremental text content. */
    readonly content: string;
    /** Whether this is the final chunk. */
    readonly done: boolean;
    /** Complete tool calls, emitted once each call's arguments have fully streamed. */
    readonly toolCalls?: readonly ToolCall[];
    /** Normalized stop reason, set on the final chunk when known. */
    readonly stopReason?: StopReason;
}

/** Token usage statistics for a request. */
export interface TokenUsage {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
}

/** Information about an available model. */
export interface ModelInfo {
    readonly id: string;
    readonly name: string;
    readonly provider: LLMProviderName;
    /** Context window size in tokens, if known. */
    readonly contextWindow?: number;
}

/**
 * The contract that every LLM provider adapter MUST implement.
 *
 * Adding a new provider means:
 * 1. Create `src/providers/<name>.ts` implementing this interface
 * 2. Register it in `src/providers/registry.ts`
 * 3. Add the name to LLMProviderName type above
 *
 * That's it. Zero changes to consumers.
 */
export interface LLMProvider {
    /** The provider's unique identifier. */
    readonly name: LLMProviderName;

    /**
     * Send a chat completion request and get the full response.
     * @throws {ProviderError} on API failure, network error, or invalid response.
     */
    chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;

    /**
     * Send a streaming chat completion request.
     * Yields incremental text chunks as they arrive.
     * @throws {ProviderError} on API failure, network error, or invalid response.
     */
    stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk>;

    /**
     * List all models available from this provider.
     * @throws {ProviderError} if the provider cannot be reached.
     */
    listModels(): Promise<ModelInfo[]>;

    /**
     * Validate that the provider connection is working (API key valid, server reachable).
     * Returns true if healthy, false otherwise. Should NOT throw.
     */
    validateConnection(): Promise<boolean>;
}
