/**
 * Plugin registry — merges plugin contributions with built-in agents/providers.
 *
 * This is the single lookup point for "all agents" and "all providers" —
 * callers don't need to know whether something is built-in or from a plugin.
 *
 * Dependency direction: plugins/registry.ts → plugins/loader, plugins/types, utils/logger
 * Used by: workflow runner (future), cli/commands/plugin.ts
 */

import { loadPlugins } from './loader.js';
import { logger } from '../utils/logger.js';
import type { LoadedPlugin, PluginAgentContribution, PluginProviderContribution } from './types.js';

export class PluginRegistry {
    private plugins: LoadedPlugin[] = [];

    /** Load all plugins from the project's plugins directory. */
    async load(projectRoot: string): Promise<void> {
        this.plugins = await loadPlugins(projectRoot);
        if (this.plugins.length > 0) {
            logger.info(`Loaded ${this.plugins.length} plugin(s): ${this.plugins.map(p => p.manifest.name).join(', ')}`);
        }
    }

    /** Get all plugin-contributed agents. */
    getAgents(): PluginAgentContribution[] {
        return this.plugins.flatMap(p => p.agents);
    }

    /** Get all plugin-contributed providers. */
    getProviders(): PluginProviderContribution[] {
        return this.plugins.flatMap(p => p.providers);
    }

    /** Get a specific plugin-contributed agent by role name. */
    getAgent(role: string): PluginAgentContribution | undefined {
        return this.getAgents().find(a => a.role === role);
    }

    /** Get a specific plugin-contributed provider by name. */
    getProvider(name: string): PluginProviderContribution | undefined {
        return this.getProviders().find(p => p.name === name);
    }

    /** List all loaded plugin manifests. */
    list(): LoadedPlugin[] {
        return [...this.plugins];
    }

    get pluginCount(): number {
        return this.plugins.length;
    }
}

/** Global singleton registry (initialized once per CLI run). */
export const globalPluginRegistry = new PluginRegistry();
