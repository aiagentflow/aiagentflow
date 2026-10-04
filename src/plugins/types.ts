/**
 * Plugin API v2 type definitions.
 *
 * A plugin is a Node module whose entry exports `manifest` plus any of:
 * - `tools`: tools agents can call (added to every agent, or only to `roles`)
 * - `providers`: LLM providers selectable via `agents.<role>.provider`
 * - `steps`: workflow steps referenced as `uses: <plugin-name>/<step-name>`
 *
 * Plugins run in-process with the same permissions as aiagentflow itself;
 * only install plugins you trust.
 *
 * Dependency direction: plugins/types.ts → agents/types, providers/types, tools/registry (types only)
 * Used by: plugins/loader.ts, plugins/registry.ts, workflow executor, agent factory
 */

import type { AgentRole } from '../agents/types.js';
import type { LLMProvider, LLMProviderName } from '../providers/types.js';
import type { Tool } from '../tools/registry.js';

/** The plugin API version this release supports. */
export const PLUGIN_API_VERSION = 2;

/** Manifest every plugin exports as `manifest`. */
export interface PluginManifest {
    /** Unique plugin name; workflow steps reference it as `<name>/<step>`. */
    name: string;
    version: string;
    /** Must be 2. v1 plugins (with `type` and agent `after` anchors) are not supported. */
    apiVersion: typeof PLUGIN_API_VERSION;
    description?: string;
}

/** A tool contributed by a plugin. */
export interface PluginTool extends Tool {
    /** Roles that get this tool (default: every role). */
    roles?: readonly AgentRole[];
}

/** A provider contributed by a plugin. */
export interface PluginProvider {
    /** Provider name used in `agents.<role>.provider` (must not clash with built-ins). */
    name: string;
    /** Create the provider from `providers.<name>` in the config (an empty object if absent). */
    create(config: Record<string, unknown>): LLMProvider;
}

/** What a plugin step can see and use. */
export interface PluginStepContext {
    /** Where the run works: the project root or its worktree. */
    projectRoot: string;
    /** The run's task. */
    task: string;
    /** Files changed so far in the run. */
    changedFiles: readonly string[];
    /** The step's `with:` options from the workflow YAML. */
    with: Readonly<Record<string, unknown>>;
    /** Log a line to the run output. */
    log(message: string): void;
}

/** What a plugin step returns. */
export interface PluginStepResult {
    /** False routes the workflow to the step's onFail target (or fails the run). */
    passed: boolean;
    /** Shown in logs and, on failure, handed to the fixer. */
    summary: string;
    /** Files the step created or changed. */
    files?: readonly string[];
}

/** A workflow step contributed by a plugin. */
export interface PluginStep {
    /** Step name; workflows use it as `uses: <plugin-name>/<name>`. */
    name: string;
    description?: string;
    run(ctx: PluginStepContext): Promise<PluginStepResult>;
}

/** What a plugin's entry module exports. */
export interface PluginExports {
    manifest: PluginManifest;
    tools?: PluginTool[];
    providers?: PluginProvider[];
    steps?: PluginStep[];
}

/** A loaded and validated plugin. */
export interface LoadedPlugin {
    manifest: PluginManifest;
    tools: PluginTool[];
    providers: PluginProvider[];
    steps: PluginStep[];
    /** Absolute path to the plugin directory. */
    path: string;
}

/** Reserved built-in provider names that plugins cannot claim. */
export const RESERVED_PROVIDER_NAMES: readonly LLMProviderName[] = [
    'anthropic', 'openai', 'gemini', 'groq', 'ollama', 'openrouter',
];
