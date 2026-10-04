/**
 * Groq provider adapter.
 *
 * Groq exposes an OpenAI-compatible API. Thin subclass of the shared adapter
 * that adds Groq defaults and a warning for compound models.
 *
 * Dependency direction: groq.ts → openai-compatible.ts, core/errors.ts
 * Used by: providers/registry.ts
 */

import { PROVIDER_DEFAULT_MODELS } from './metadata.js';
import { ProviderError } from '../core/errors.js';
import { logger } from '../utils/logger.js';
import { OpenAICompatibleProvider, withV1 } from './openai-compatible.js';
import { PROVIDER_TIMEOUT_MS } from './provider-errors.js';

/** Configuration required to create a Groq provider. */
export interface GroqProviderConfig {
    readonly apiKey: string;
    readonly baseUrl?: string;
}

/**
 * Groq compound models use internal tool-calling which inflates request
 * payload size significantly. Agents that receive large upstream context
 * (coder, fixer, reviewer) will hit 413 Payload Too Large.
 */
const COMPOUND_MODELS = new Set(['compound-beta', 'compound-beta-mini', 'groq/compound-mini', 'groq/compound-beta']);

/** Default Groq API settings. */
const DEFAULTS = {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: PROVIDER_DEFAULT_MODELS.groq,
} as const;

export class GroqProvider extends OpenAICompatibleProvider {
    public readonly name = 'groq' as const;

    constructor(config: GroqProviderConfig) {
        if (!config.apiKey) {
            throw new ProviderError('Groq API key is required', { provider: 'groq' });
        }
        super({
            name: 'groq',
            label: 'Groq',
            baseUrl: withV1(config.baseUrl ?? DEFAULTS.baseUrl),
            defaultModel: DEFAULTS.model,
            timeoutMs: PROVIDER_TIMEOUT_MS,
            maxTokensField: 'max_completion_tokens',
            headers: { Authorization: `Bearer ${config.apiKey}` },
        });
    }

    protected override beforeRequest(model: string): void {
        if (COMPOUND_MODELS.has(model)) {
            logger.warn(
                `Groq compound model "${model}" may cause 413 errors when used with coder/fixer/reviewer agents ` +
                `due to large prompt payloads. Consider switching those agents to llama-3.3-70b-versatile.`,
            );
        }
    }
}
