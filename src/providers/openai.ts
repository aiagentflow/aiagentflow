/**
 * OpenAI provider adapter.
 *
 * Thin subclass of the shared OpenAI-compatible adapter.
 *
 * Dependency direction: openai.ts → openai-compatible.ts, core/errors.ts
 * Used by: providers/registry.ts
 */

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
    model: 'gpt-4o-mini',
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
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                ...(config.organization ? { 'OpenAI-Organization': config.organization } : {}),
            },
        });
    }
}
