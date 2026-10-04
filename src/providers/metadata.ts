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
    groq: 'Groq',
    ollama: 'Ollama (Local)',
    openai: 'OpenAI (GPT)',
    openrouter: 'OpenRouter',
};

/**
 * Default model ID to use when the user does not specify one.
 * Checked against each provider's model list in October 2026; refresh every release.
 */
export const PROVIDER_DEFAULT_MODELS: Record<LLMProviderName, string> = {
    anthropic: 'claude-opus-5-5',
    gemini: 'gemini-2.5-flash',
    groq: 'llama-3.3-70b-versatile',
    ollama: 'llama3.2:latest',
    openai: 'gpt-5-mini',
    // Free OpenRouter models come and go; this one supports tool calling
    openrouter: 'qwen/qwen3.8-27b:free',
};

/** Short description shown as the choice text in the init wizard's provider selector. */
export const PROVIDER_DESCRIPTIONS: Record<LLMProviderName, string> = {
    anthropic: 'Anthropic (Claude) — requires API key',
    gemini: 'Google Gemini — requires API key',
    groq: 'Groq — fast OpenAI-compatible inference, requires API key',
    ollama: 'Ollama (Local Models) — free, no API key needed',
    openai: 'OpenAI (GPT) — requires API key',
    openrouter: 'OpenRouter — access 100+ models, free tier available, requires API key',
};
