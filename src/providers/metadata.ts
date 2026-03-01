/**
 * Centralized provider display metadata.
 *
 * Replaces scattered ternary chains in init.ts, doctor.ts, and registry.ts
 * with a single source of truth for provider labels, default models, and
 * description text used in the CLI wizard.
 *
 * Dependency direction: metadata.ts → providers/types.ts (leaf-ish module)
 * Used by: cli/commands/init.ts, cli/commands/doctor.ts, providers/registry.ts
 */

import type { LLMProviderName } from './types.js';

/** Human-friendly labels for each provider. */
export const PROVIDER_LABELS: Record<LLMProviderName, string> = {
    anthropic: 'Anthropic (Claude)',
    gemini: 'Google Gemini',
    ollama: 'Ollama (Local)',
    openai: 'OpenAI (GPT)',
};

/** Default model ID to use when the user does not specify one. */
export const PROVIDER_DEFAULT_MODELS: Record<LLMProviderName, string> = {
    anthropic: 'claude-sonnet-4-20250514',
    gemini: 'gemini-2.0-flash',
    ollama: 'llama3.2:latest',
    openai: 'gpt-4o-mini',
};

/** Short description shown as the choice text in the init wizard's provider selector. */
export const PROVIDER_DESCRIPTIONS: Record<LLMProviderName, string> = {
    anthropic: 'Anthropic (Claude) — requires API key',
    gemini: 'Google Gemini — requires API key',
    ollama: 'Ollama (Local Models) — free, no API key needed',
    openai: 'OpenAI (GPT) — requires API key',
};
