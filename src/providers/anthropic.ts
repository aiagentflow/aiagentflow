/**
 * Anthropic Claude provider adapter.
 *
 * Uses the Anthropic Messages API directly via fetch() — no SDK dependency.
 * This gives full control over request/response handling and keeps deps minimal.
 *
 * Dependency direction: anthropic.ts → providers/types.ts, core/errors.ts
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
import { getConnectionPool } from '../utils/connection-pool.js';
import { getResponseCache, generateCacheKey } from '../utils/response-cache.js';
import { getContextOptimizer } from '../utils/context-optimizer.js';

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
  model: 'claude-sonnet-4-20250514',
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
   */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const optimizer = getContextOptimizer();
    const { systemPrompt, apiMessages } = this.prepareMessages(messages, options);
    const model = options?.model ?? DEFAULTS.model;
    const maxTokens = options?.maxTokens ?? DEFAULTS.maxTokens;

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: apiMessages,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }
    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (options?.stopSequences?.length) {
      body.stop_sequences = options.stopSequences;
    }

    const cacheKey = generateCacheKey(apiMessages, {
      model,
      temperature: options?.temperature,
      maxTokens,
    });
    const cache = getResponseCache<ChatResponse>();

    const cached = cache.get(cacheKey);
    if (cached) {
      logger.debug(`Anthropic cache hit: model=${model}`);
      return cached;
    }

    logger.debug(`Anthropic chat request: model=${model}, messages=${apiMessages.length}`);

    const response = await this.request('/v1/messages', body);

    const content = this.extractContent(response);
    const usage = this.extractUsage(response);

    const result: ChatResponse = {
      content,
      model: (response.model as string | undefined) ?? model,
      usage,
      finishReason: (response.stop_reason as string | undefined) ?? 'unknown',
    };

    cache.set(cacheKey, result);

    return result;
  }

  /**
   * Send a streaming chat completion request.
   */
  async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk> {
    const { systemPrompt, apiMessages } = this.prepareMessages(messages, options);
    const model = options?.model ?? DEFAULTS.model;
    const maxTokens = options?.maxTokens ?? DEFAULTS.maxTokens;

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: apiMessages,
      stream: true,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }
    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ProviderError(
        `Anthropic streaming request failed: ${response.status} ${response.statusText}`,
        { status: response.status, body: errorBody, provider: 'anthropic' },
      );
    }

    if (!response.body) {
      throw new ProviderError('Anthropic response has no body', { provider: 'anthropic' });
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
            if (event.type === 'content_block_delta' && event.delta?.text) {
              yield { content: event.delta.text, done: false };
            } else if (event.type === 'message_stop') {
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
   * List available models (Anthropic doesn't have a models endpoint,
   * so we return a curated list of known models).
   */
  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        provider: 'anthropic',
        contextWindow: 200000,
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        contextWindow: 200000,
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        provider: 'anthropic',
        contextWindow: 200000,
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        provider: 'anthropic',
        contextWindow: 200000,
      },
    ];
  }

  /**
   * Validate that the Anthropic API connection is working.
   */
  async validateConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: DEFAULTS.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });

      // A 200 or 400 (bad request but authenticated) means the key works
      return response.status === 200 || response.status === 400;
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

  private async request(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderError(
        `Failed to connect to Anthropic API: ${err instanceof Error ? err.message : String(err)}`,
        { provider: 'anthropic', baseUrl: this.baseUrl },
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ProviderError(`Anthropic API error: ${response.status} ${response.statusText}`, {
        status: response.status,
        body: errorBody,
        provider: 'anthropic',
      });
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  /**
   * Separate system prompt from messages (Anthropic uses a top-level field).
   */
  private prepareMessages(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): { systemPrompt: string | undefined; apiMessages: Array<{ role: string; content: string }> } {
    let systemPrompt = options?.systemPrompt;
    const apiMessages: Array<{ role: string; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Anthropic doesn't support system role in messages array
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
      } else {
        apiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    return { systemPrompt, apiMessages };
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
    const usage = response.usage as Record<string, number> | undefined;
    return {
      promptTokens: usage?.input_tokens ?? 0,
      completionTokens: usage?.output_tokens ?? 0,
      totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
    };
  }
}
