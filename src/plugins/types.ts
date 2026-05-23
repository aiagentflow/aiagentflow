/**
 * Plugin system type definitions.
 *
 * A plugin is a Node module that exports a manifest describing what it
 * contributes: custom agents, custom providers, or both.
 *
 * Dependency direction: plugins/types.ts → nothing (leaf module)
 * Used by: plugins/loader.ts, plugins/registry.ts
 */

import type { AgentRole } from '../agents/types.js';
import type { LLMProviderName } from '../providers/types.js';

/** Types of contribution a plugin can make. */
export type PluginType = 'agent' | 'provider' | 'both';

/** Manifest that every plugin module must export as `manifest`. */
export interface PluginManifest {
    /** Unique plugin identifier (npm package name or local folder name). */
    name: string;
    /** Human-readable plugin version. */
    version: string;
    /** What the plugin contributes. */
    type: PluginType;
    /** Path to the plugin entry point, relative to the package root. */
    entry: string;
    /** Optional human-readable description. */
    description?: string;
}

/** A custom agent contribution. */
export interface PluginAgentContribution {
    /** The agent role name (must not clash with built-in roles). */
    role: string;
    /** Display label used in logs and UI. */
    label: string;
    /**
     * Position in the DAG — after which built-in agent should this agent run?
     * Use 'coder' to run after coding, 'tester' to run after testing, etc.
     */
    after: AgentRole;
    /** Factory function that creates the agent instance. */
    create: (opts: { model: string; temperature: number; maxTokens: number }) => PluginAgentInstance;
}

/** Minimal agent interface that plugin agents must satisfy. */
export interface PluginAgentInstance {
    execute(input: { task: string; context?: string; previousOutput?: string }): Promise<{
        content: string;
        tokensUsed: number;
        success: boolean;
    }>;
}

/** A custom provider contribution. */
export interface PluginProviderContribution {
    /** Provider name (must not clash with built-in names). */
    name: string;
    /** Factory function that creates a provider instance. */
    create: (config: Record<string, unknown>) => PluginProviderInstance;
}

/** Minimal provider interface that plugin providers must satisfy. */
export interface PluginProviderInstance {
    chat(messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>): Promise<{ content: string; usage: { totalTokens: number } }>;
}

/** What a plugin's entry module exports. */
export interface PluginExports {
    manifest: PluginManifest;
    agents?: PluginAgentContribution[];
    providers?: PluginProviderContribution[];
}

/** A fully-loaded plugin with resolved contributions. */
export interface LoadedPlugin {
    manifest: PluginManifest;
    agents: PluginAgentContribution[];
    providers: PluginProviderContribution[];
    /** Absolute path to the plugin directory. */
    path: string;
}

/** Reserved built-in role names that plugins cannot claim. */
export const RESERVED_AGENT_ROLES: readonly string[] = [
    'architect', 'coder', 'reviewer', 'security', 'tester', 'fixer', 'judge',
];

/** Reserved built-in provider names that plugins cannot claim. */
export const RESERVED_PROVIDER_NAMES: readonly LLMProviderName[] = [
    'anthropic', 'openai', 'gemini', 'groq', 'ollama', 'openrouter',
];
