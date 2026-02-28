/**
 * OpenAI GPT provider adapter.
 *
 * Uses the OpenAI Chat Completions API directly via fetch() — no SDK dependency.
 * This gives full control over request/response handling and keeps deps minimal.
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
  readonly project?: string;
}

/** Default OpenAI API settings. */
const DEFAULTS = {
  baseUrl: 'https://api.openai.com',
  model: 'gpt-4o',
  maxTokens: 4096,
} as const;

/**
 * OpenAI GPT provider implementation.
 *
 * Implements the LLMProvider interface using the OpenAI Chat Completions API.
 */
export class OpenAIProvider implements LLMProvider {
  public readonly name = 'openai' as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly organization?: string;
  private readonly project?: string;

  constructor(config: OpenAIProviderConfig) {
    if (!config.apiKey) {
      throw new ProviderError('OpenAI API key is required', { provider: 'openai' });
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULTS.baseUrl;
    this.organization = config.organization;
    this.project = config.project;
  }

  /**
   * Send a non-streaming chat completion request.
   */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const apiMessages = this.prepareMessages(messages, options);
    const model = options?.model ?? DEFAULTS.model;
    const maxTokens = options?.maxTokens ?? DEFAULTS.maxTokens;

    const body: Record<string, unknown> = {
      model,
      messages: apiMessages,
      max_tokens: maxTokens,
    };

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (options?.stopSequences?.length) {
      body.stop = options.stopSequences;
    }

    logger.debug(`OpenAI chat request: model=${model}, messages=${apiMessages.length}`);

    const response = await this.request('/v1/chat/completions', body);

    const content = this.extractContent(response);
    const usage = this.extractUsage(response);

    return {
      content,
      model: (response.model as string | undefined) ?? model,
      usage,
      finishReason: this.extractFinishReason(response),
    };
  }

  /**
   * Send a streaming chat completion request.
   */
  async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk> {
    const apiMessages = this.prepareMessages(messages, options);
    const model = options?.model ?? DEFAULTS.model;
    const maxTokens = options?.maxTokens ?? DEFAULTS.maxTokens;

    const body: Record<string, unknown> = {
      model,
      messages: apiMessages,
      max_tokens: maxTokens,
      stream: true,
    };

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (options?.stopSequences?.length) {
      body.stop = options.stopSequences;
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
            if (event.choices?.[0]?.delta?.content) {
              yield {
                content: event.choices[0].delta.content as string,
                done: event.choices[0].finish_reason !== null,
              };
            } else if (event.choices?.[0]?.finish_reason) {
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
   * List available models (OpenAI provides a models endpoint).
   */
  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new ProviderError(`Failed to list OpenAI models: ${response.status}`, {
          provider: 'openai',
          status: response.status,
        });
      }

      const data = (await response.json()) as { data?: Array<Record<string, unknown>> };
      const models = data.data ?? [];

      return models
        .filter((m) => String(m.id).startsWith('gpt-'))
        .map((m) => ({
          id: String(m.id),
          name: this.getModelName(String(m.id)),
          provider: 'openai' as const,
          contextWindow: this.getContextWindow(String(m.id)),
        }));
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        `Failed to connect to OpenAI at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        { provider: 'openai', baseUrl: this.baseUrl },
      );
    }
  }

  /**
   * Validate that the OpenAI API connection is working.
   */
  async validateConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: DEFAULTS.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });

      // A 200 or 401 (bad request but authenticated) means the key works
      return response.status === 200 || response.status === 401;
    } catch {
      return false;
    }
  }

  // ── Private helpers ──

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.organization) {
      headers['OpenAI-Organization'] = this.organization;
    }

    if (this.project) {
      headers['OpenAI-Project'] = this.project;
    }

    return headers;
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
        `Failed to connect to OpenAI API: ${err instanceof Error ? err.message : String(err)}`,
        { provider: 'openai', baseUrl: this.baseUrl },
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ProviderError(`OpenAI API error: ${response.status} ${response.statusText}`, {
        status: response.status,
        body: errorBody,
        provider: 'openai',
      });
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  /**
   * Prepare messages for OpenAI API format.
   * OpenAI supports system messages in the messages array.
   */
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

  private extractContent(response: Record<string, unknown>): string {
    const choices = response.choices as Array<Record<string, unknown>> | undefined;
    if (choices && choices[0]?.message) {
      const message = choices[0].message as Record<string, unknown>;
      return String(message.content ?? '');
    }
    return '';
  }

  private extractUsage(response: Record<string, unknown>): TokenUsage {
    const usage = response.usage as Record<string, number> | undefined;
    return {
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
    };
  }

  private extractFinishReason(response: Record<string, unknown>): string {
    const choices = response.choices as Array<Record<string, unknown>> | undefined;
    if (choices && choices[0]) {
      return String(choices[0].finish_reason ?? 'unknown');
    }
    return 'unknown';
  }

  /**
   * Get a human-readable model name from the model ID.
   */
  private getModelName(modelId: string): string {
    const names: Record<string, string> = {
      'gpt-4o': 'GPT-4o',
      'gpt-4o-mini': 'GPT-4o Mini',
      'gpt-4-turbo': 'GPT-4 Turbo',
      'gpt-4': 'GPT-4',
      'gpt-3.5-turbo': 'GPT-3.5 Turbo',
    };
    return names[modelId] ?? modelId;
  }

  /**
   * Get the context window size for a given model.
   */
  private getContextWindow(modelId: string): number {
    const windows: Record<string, number> = {
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      'gpt-4-turbo': 128000,
      'gpt-4': 8192,
      'gpt-4-32k': 32768,
      'gpt-3.5-turbo': 16385,
      'gpt-3.5-turbo-16k': 16385,
    };
    return windows[modelId] ?? 4096;
  }
}
