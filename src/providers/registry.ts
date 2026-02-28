/**
 * Provider registry — factory that creates the correct provider from config.
 *
 * New providers are added by:
 * 1. Create the adapter file in src/providers/
 * 2. Register it in the PROVIDER_FACTORIES map below
 * 3. Add the name to LLMProviderName type in types.ts
 *
 * Dependency direction: registry.ts → types.ts, anthropic.ts, ollama.ts, errors.ts
 * Used by: workflow engine, CLI doctor command
 */

import type { LLMProvider, LLMProviderName } from './types.js';
import { AnthropicProvider, type AnthropicProviderConfig } from './anthropic.js';
import { OllamaProvider, type OllamaProviderConfig } from './ollama.js';
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

  ollama: (config: ProviderConfig) => {
    const ollamaConfig = config.ollama;
    return new OllamaProvider(ollamaConfig as OllamaProviderConfig | undefined);
  },
};

/** Cache of created provider instances (one per provider name). */
const providerCache = new Map<LLMProviderName, LLMProvider>();

/**
 * Create (or return cached) a provider instance by name.
 *
 * @param name - The provider name ('anthropic' | 'ollama')
 * @param config - The providers section of the app config
 * @returns An LLMProvider instance
 * @throws {ProviderError} if the provider name is unknown or config is missing
 */
export function createProvider(name: LLMProviderName, config: ProviderConfig): LLMProvider {
  // Return cached instance if available
  const cached = providerCache.get(name);
  if (cached) return cached;

  const factory = PROVIDER_FACTORIES[name];
  if (!factory) {
    throw new ProviderError(
      `Unknown provider: "${name}". Available: ${Object.keys(PROVIDER_FACTORIES).join(', ')}`,
      { provider: name, available: Object.keys(PROVIDER_FACTORIES) },
    );
  }

  logger.debug(`Creating provider: ${name}`);
  const provider = factory(config);
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
      if (name === 'anthropic' && !config.anthropic) {
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
