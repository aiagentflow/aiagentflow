/**
 * OpenRouter provider adapter.
 *
 * OpenRouter exposes an OpenAI-compatible Chat Completions API that proxies
 * hundreds of models (including many free-tier ones). Useful for testing
 * without hitting per-provider rate limits.
 *
 * Free models: append ":free" to the model ID, e.g. "qwen/qwen3.8-27b:free" (the free list changes often)
 * Full model list: https://openrouter.ai/models
 *
 * Dependency direction: openrouter.ts → openai-compatible.ts, core/errors.ts
 * Used by: providers/registry.ts
 */

import { PROVIDER_DEFAULT_MODELS } from './metadata.js';
import { ProviderError } from '../core/errors.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { PROVIDER_TIMEOUT_MS } from './provider-errors.js';

/** Configuration required to create an OpenRouter provider. */
export interface OpenRouterProviderConfig {
    readonly apiKey: string;
    readonly baseUrl?: string;
    /** Shown in OpenRouter usage dashboard and rankings. */
    readonly siteUrl?: string;
    readonly siteName?: string;
}

/** Default OpenRouter API settings. */
const DEFAULTS = {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: PROVIDER_DEFAULT_MODELS.openrouter,
    siteUrl: 'https://github.com/aiagentflow/aiagentflow',
    siteName: 'aiagentflow',
} as const;

export class OpenRouterProvider extends OpenAICompatibleProvider {
    public readonly name = 'openrouter' as const;

    constructor(config: OpenRouterProviderConfig) {
        if (!config.apiKey) {
            throw new ProviderError('OpenRouter API key is required', { provider: 'openrouter' });
        }
        super({
            name: 'openrouter',
            label: 'OpenRouter',
            baseUrl: config.baseUrl ?? DEFAULTS.baseUrl,
            defaultModel: DEFAULTS.model,
            timeoutMs: PROVIDER_TIMEOUT_MS,
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'HTTP-Referer': config.siteUrl ?? DEFAULTS.siteUrl,
                'X-Title': config.siteName ?? DEFAULTS.siteName,
            },
        });
    }
}
