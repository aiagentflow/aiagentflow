/**
 * OpenAI provider adapter.
 *
 * Thin subclass of the shared OpenAI-compatible adapter.
 *
 * Dependency direction: openai.ts → openai-compatible.ts, core/errors.ts
 * Used by: providers/registry.ts
 */

import { PROVIDER_DEFAULT_MODELS } from './metadata.js';
import { ProviderError } from '../core/errors.js';
import { OpenAICompatibleProvider, withV1 } from './openai-compatible.js';
import { PROVIDER_TIMEOUT_MS } from './provider-errors.js';

/** Configuration required to create an OpenAI provider. */
export interface OpenAIProviderConfig {
    readonly apiKey: string;
    readonly baseUrl?: string;
    readonly organization?: string;
}

/** Default OpenAI API settings. */
const DEFAULTS = {
    baseUrl: 'https://api.openai.com',
    model: PROVIDER_DEFAULT_MODELS.openai,
} as const;

export class OpenAIProvider extends OpenAICompatibleProvider {
    public readonly name = 'openai' as const;

    constructor(config: OpenAIProviderConfig) {
        if (!config.apiKey) {
            throw new ProviderError('OpenAI API key is required', { provider: 'openai' });
        }
        super({
            name: 'openai',
            label: 'OpenAI',
            baseUrl: withV1(config.baseUrl ?? DEFAULTS.baseUrl),
            defaultModel: DEFAULTS.model,
            timeoutMs: PROVIDER_TIMEOUT_MS,
            // Accepted by every current chat model; reasoning models reject max_tokens
            maxTokensField: 'max_completion_tokens',
            acceptsTemperature: model => !isReasoningModel(model),
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                ...(config.organization ? { 'OpenAI-Organization': config.organization } : {}),
            },
        });
    }
}

/**
 * OpenAI reasoning models (o-series, GPT-5 and later) only accept the default
 * temperature, so it is omitted for them.
 */
export function isReasoningModel(model: string): boolean {
    return /^(o\d|gpt-(?:[5-9]|\d{2,}))/.test(model);
}
