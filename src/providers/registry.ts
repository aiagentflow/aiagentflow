/**
 * Provider registry — factory that creates the correct provider from config.
 *
 * New providers are added by:
 * 1. Create the adapter file in src/providers/
 * 2. Register it in the PROVIDER_FACTORIES map below
 * 3. Add the name to LLMProviderName type in types.ts
 *
 * Dependency direction: registry.ts → types.ts, provider adapters, errors.ts
 * Used by: workflow engine, CLI doctor command
 */

import type { LLMProvider, LLMProviderName } from './types.js';
import { AnthropicProvider, type AnthropicProviderConfig } from './anthropic.js';
import { GeminiProvider, type GeminiProviderConfig } from './gemini.js';
import { GroqProvider, type GroqProviderConfig } from './groq.js';
import { OllamaProvider, type OllamaProviderConfig } from './ollama.js';
import { OpenAIProvider, type OpenAIProviderConfig } from './openai.js';
import { OpenRouterProvider, type OpenRouterProviderConfig } from './openrouter.js';
import type { ProviderConfig } from '../core/config/types.js';
import { ProviderError } from '../core/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Factory functions for each provider.
 * Add new providers here — this is the ONLY place that needs to change.
 */
const PROVIDER_FACTORIES: Record<LLMProviderName, (config: ProviderConfig) => LLMProvider> = {
    anthropic: (config: ProviderConfig) => {
        const anthropicConfig = config.anthropic;
        if (!anthropicConfig) {
            throw new ProviderError(
                'Anthropic provider is not configured. Run "aiagentflow init" to set up.',
                { provider: 'anthropic' },
            );
        }
        return new AnthropicProvider(anthropicConfig as AnthropicProviderConfig);
    },

    gemini: (config: ProviderConfig) => {
        const geminiConfig = config.gemini;
        if (!geminiConfig) {
            throw new ProviderError(
                'Gemini provider is not configured. Run "aiagentflow init" to set up.',
                { provider: 'gemini' },
            );
        }
        return new GeminiProvider(geminiConfig as GeminiProviderConfig);
    },

    groq: (config: ProviderConfig) => {
        const groqConfig = config.groq;
        if (!groqConfig) {
            throw new ProviderError(
                'Groq provider is not configured. Run "aiagentflow init" to set up.',
                { provider: 'groq' },
            );
        }
        return new GroqProvider(groqConfig as GroqProviderConfig);
    },

    ollama: (config: ProviderConfig) => {
        const ollamaConfig = config.ollama;
        return new OllamaProvider(ollamaConfig as OllamaProviderConfig | undefined);
    },

    openai: (config: ProviderConfig) => {
        const openaiConfig = config.openai;
        if (!openaiConfig) {
            throw new ProviderError(
                'OpenAI provider is not configured. Run "aiagentflow init" to set up.',
                { provider: 'openai' },
            );
        }
        return new OpenAIProvider(openaiConfig as OpenAIProviderConfig);
    },

    openrouter: (config: ProviderConfig) => {
        const openrouterConfig = config.openrouter;
        if (!openrouterConfig) {
            throw new ProviderError(
                'OpenRouter provider is not configured. Run "aiagentflow init" to set up.',
                { provider: 'openrouter' },
            );
        }
        return new OpenRouterProvider(openrouterConfig as OpenRouterProviderConfig);
    },
};

/** Providers contributed by plugins, keyed by name. */
const externalFactories = new Map<string, (config: Record<string, unknown>) => LLMProvider>();

/**
 * Register a provider from outside the built-ins (a plugin).
 * Its config is `providers.<name>` from the config file (an empty object if absent).
 */
export function registerExternalProvider(name: string, factory: (config: Record<string, unknown>) => LLMProvider): void {
    externalFactories.set(name, factory);
    providerCache.delete(name);
}

/** Cache of created provider instances (one per provider name). */
const providerCache = new Map<string, LLMProvider>();

/**
 * Create (or return cached) a provider instance by name.
 *
 * @param name - The provider name
 * @param config - The providers section of the app config
 * @returns An LLMProvider instance
 * @throws {ProviderError} if the provider name is unknown or config is missing
 */
export function createProvider(name: string, config: ProviderConfig): LLMProvider {
    // Return cached instance if available
    const cached = providerCache.get(name);
    if (cached) return cached;

    const builtIn = PROVIDER_FACTORIES[name as LLMProviderName];
    const external = externalFactories.get(name);
    if (!builtIn && !external) {
        const available = [...Object.keys(PROVIDER_FACTORIES), ...externalFactories.keys()];
        throw new ProviderError(
            `Unknown provider: "${name}". Available: ${available.join(', ')}. Plugin providers need their plugin installed.`,
            { provider: name, available },
        );
    }

    logger.debug(`Creating provider: ${name}`);
    const provider = builtIn
        ? builtIn(config)
        : external!(((config as Record<string, unknown>)[name] as Record<string, unknown> | undefined) ?? {});
    providerCache.set(name, provider);
    return provider;
}

/**
 * Clear the provider cache (useful for testing or config changes).
 */
export function clearProviderCache(): void {
    providerCache.clear();
}

/**
 * Get all supported provider names.
 */
export function getSupportedProviders(): LLMProviderName[] {
    return Object.keys(PROVIDER_FACTORIES) as LLMProviderName[];
}

/**
 * Validate all configured providers can connect.
 * Returns a map of provider name → connection status.
 */
export async function validateAllProviders(
    config: ProviderConfig,
): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const name of getSupportedProviders()) {
        try {
            // Only validate providers that are actually configured
            if (name !== 'ollama' && !config[name as keyof typeof config]) {
                results[name] = false;
                continue;
            }

            const provider = createProvider(name, config);
            results[name] = await provider.validateConnection();
        } catch {
            results[name] = false;
        }
    }

    return results;
}
