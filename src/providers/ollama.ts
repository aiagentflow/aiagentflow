/**
 * Ollama local model provider adapter.
 *
 * Connects to the Ollama HTTP API (default: http://localhost:11434).
 * Supports chat completion, streaming, model listing, and health checks.
 *
 * Dependency direction: ollama.ts → providers/types.ts, core/errors.ts
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

/** Configuration required to create an Ollama provider. */
export interface OllamaProviderConfig {
  readonly baseUrl?: string;
}

/** Default Ollama settings. */
const DEFAULTS = {
  baseUrl: 'http://localhost:11434',
  model: 'llama3.2:latest',
} as const;

/**
 * Ollama local model provider implementation.
 *
 * Implements the LLMProvider interface for locally-running models via Ollama.
 */
export class OllamaProvider implements LLMProvider {
  public readonly name = 'ollama' as const;
  private readonly baseUrl: string;

  constructor(config?: OllamaProviderConfig) {
    this.baseUrl = config?.baseUrl ?? DEFAULTS.baseUrl;
  }

  /**
   * Send a non-streaming chat completion request.
   */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model ?? DEFAULTS.model;
    const ollamaMessages = this.prepareMessages(messages, options);

    const body: Record<string, unknown> = {
      model,
      messages: ollamaMessages,
      stream: false,
    };

    if (options?.temperature !== undefined) {
      body.options = {
        ...((body.options as Record<string, unknown>) ?? {}),
        temperature: options.temperature,
      };
    }
    if (options?.maxTokens !== undefined) {
      body.options = {
        ...((body.options as Record<string, unknown>) ?? {}),
        num_predict: options.maxTokens,
      };
    }

    logger.debug(`Ollama chat request: model=${model}, messages=${ollamaMessages.length}`);

    const response = await this.request('/api/chat', body);

    return {
      content: (response.message as Record<string, string>)?.content ?? '',
      model: (response.model as string) ?? model,
      usage: this.extractUsage(response),
      finishReason: (response.done_reason as string) ?? 'stop',
    };
  }

  /**
   * Send a streaming chat completion request.
   */
  async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk> {
    const model = options?.model ?? DEFAULTS.model;
    const ollamaMessages = this.prepareMessages(messages, options);

    const body: Record<string, unknown> = {
      model,
      messages: ollamaMessages,
      stream: true,
    };

    if (options?.temperature !== undefined) {
      body.options = {
        ...((body.options as Record<string, unknown>) ?? {}),
        temperature: options.temperature,
      };
    }
    if (options?.maxTokens !== undefined) {
      body.options = {
        ...((body.options as Record<string, unknown>) ?? {}),
        num_predict: options.maxTokens,
      };
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderError(
        `Failed to connect to Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        { provider: 'ollama', baseUrl: this.baseUrl },
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ProviderError(
        `Ollama streaming request failed: ${response.status} ${response.statusText}`,
        { status: response.status, body: errorBody, provider: 'ollama' },
      );
    }

    if (!response.body) {
      throw new ProviderError('Ollama response has no body', { provider: 'ollama' });
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
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);
            const content = data.message?.content ?? '';
            const isDone = data.done === true;

            if (content || isDone) {
              yield { content, done: isDone };
            }

            if (isDone) return;
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
   * List available models from the local Ollama instance.
   */
  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);

      if (!response.ok) {
        throw new ProviderError(`Failed to list Ollama models: ${response.status}`, {
          provider: 'ollama',
          status: response.status,
        });
      }

      const data = (await response.json()) as { models?: Array<Record<string, unknown>> };
      const models = data.models ?? [];

      return models.map((m) => ({
        id: String(m.name ?? m.model ?? ''),
        name: String(m.name ?? m.model ?? 'Unknown'),
        provider: 'ollama' as const,
      }));
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        `Failed to connect to Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        { provider: 'ollama', baseUrl: this.baseUrl },
      );
    }
  }

  /**
   * Validate that Ollama is running and reachable.
   */
  async validateConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  // ── Private helpers ──

  private prepareMessages(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [];

    // Add system prompt if provided via options
    if (options?.systemPrompt) {
      result.push({ role: 'system', content: options.systemPrompt });
    }

    for (const msg of messages) {
      result.push({ role: msg.role, content: msg.content });
    }

    return result;
  }

  private async request(
    path: string,
    body: Record<string, unknown>,
    retries = 2,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        response = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(300_000), // 5 minute timeout
        });

        // Success — continue to response handling below
        break;
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          logger.debug(
            `Ollama request failed (attempt ${attempt + 1}/${retries + 1}), retrying...`,
          );
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw new ProviderError(
          `Failed to connect to Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
          { provider: 'ollama', baseUrl: this.baseUrl },
        );
      }
    }

    // TypeScript needs this — response is always assigned if we reach here
    response = response!;

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ProviderError(`Ollama API error: ${response.status} ${response.statusText}`, {
        status: response.status,
        body: errorBody,
        provider: 'ollama',
      });
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  private extractUsage(response: Record<string, unknown>): TokenUsage {
    return {
      promptTokens: (response.prompt_eval_count as number) ?? 0,
      completionTokens: (response.eval_count as number) ?? 0,
      totalTokens:
        ((response.prompt_eval_count as number) ?? 0) + ((response.eval_count as number) ?? 0),
    };
  }
}
