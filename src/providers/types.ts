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
export type LLMProviderName = 'anthropic' | 'ollama';

/** Role in a chat conversation. */
export type ChatRole = 'system' | 'user' | 'assistant';

/** A single message in a chat conversation. */
export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
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
}

/** Response from a non-streaming chat completion. */
export interface ChatResponse {
  /** The generated text content. */
  readonly content: string;
  /** The model that was used. */
  readonly model: string;
  /** Token usage statistics. */
  readonly usage: TokenUsage;
  /** Provider-specific finish reason. */
  readonly finishReason: string;
}

/** A single chunk in a streaming response. */
export interface ChatChunk {
  /** Incremental text content. */
  readonly content: string;
  /** Whether this is the final chunk. */
  readonly done: boolean;
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
