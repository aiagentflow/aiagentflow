/**
 * Model picker — fetches available models from a provider and lets the user choose.
 *
 * Falls back to free-text input if the model list cannot be fetched.
 *
 * Dependency direction: model-picker.ts → providers/types, providers/registry, providers/metadata, prompts, ora
 * Used by: cli/commands/init.ts
 */

import prompts from 'prompts';
import ora from 'ora';
import type { LLMProviderName } from '../../providers/types.js';
import type { ProviderConfig } from '../../core/config/types.js';
import { createProvider, clearProviderCache } from '../../providers/registry.js';
import { PROVIDER_DEFAULT_MODELS } from '../../providers/metadata.js';

/** Maximum number of models to show in a simple select list. */
const SELECT_THRESHOLD = 20;

/**
 * Let the user pick a model from the provider's live model list.
 *
 * @param providerName - Which provider to query
 * @param providerConfig - The providers section of the config (needs connection info)
 * @param message - Prompt message shown to the user
 * @returns The chosen model ID, or null if the user cancelled
 */
export async function pickModel(
    providerName: LLMProviderName,
    providerConfig: ProviderConfig,
    message: string,
): Promise<string | null> {
    const defaultModel = PROVIDER_DEFAULT_MODELS[providerName];

    // Clear cache so we get a fresh provider with current config
    clearProviderCache();

    const spinner = ora('Fetching available models...').start();
    try {
        const provider = createProvider(providerName, providerConfig);
        const models = await provider.listModels();
        spinner.stop();

        if (models.length === 0) {
            return await fallbackTextInput(message, defaultModel);
        }

        // Build choices sorted alphabetically
        const choices = models
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((m) => {
                const ctxInfo = m.contextWindow ? ` (${formatContextWindow(m.contextWindow)})` : '';
                return {
                    title: `${m.id}${ctxInfo}`,
                    value: m.id,
                };
            });

        // Find initial selection index
        const defaultIndex = choices.findIndex((c) => c.value === defaultModel);
        const initial = defaultIndex >= 0 ? defaultIndex : 0;

        if (models.length <= SELECT_THRESHOLD) {
            const { model } = await prompts({
                type: 'select',
                name: 'model',
                message,
                choices,
                initial,
            });
            return model ?? null;
        }

        // Too many models — use autocomplete with filter
        const { model } = await prompts({
            type: 'autocomplete',
            name: 'model',
            message,
            choices,
            initial: defaultModel,
            suggest: (input: string, choices: prompts.Choice[]) => {
                const lower = input.toLowerCase();
                return Promise.resolve(
                    choices.filter((c) => c.title.toLowerCase().includes(lower)),
                );
            },
        });
        return model ?? null;
    } catch {
        spinner.stop();
        return await fallbackTextInput(message, defaultModel);
    }
}

async function fallbackTextInput(message: string, defaultModel: string): Promise<string | null> {
    const { model } = await prompts({
        type: 'text',
        name: 'model',
        message: `${message} (could not fetch model list)`,
        initial: defaultModel,
    });
    return model ?? null;
}

function formatContextWindow(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M ctx`;
    if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K ctx`;
    return `${tokens} ctx`;
}
