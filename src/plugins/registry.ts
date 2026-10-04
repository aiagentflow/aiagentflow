/**
 * Plugin registry: the loaded plugins and lookups for their contributions.
 *
 * Loading the registry also registers plugin providers with the provider
 * registry, so `agents.<role>.provider` can name them.
 *
 * Dependency direction: plugins/registry.ts → plugins/loader, plugins/types, providers/registry, utils/logger
 * Used by: workflow runner and executor, agent factory, cli/commands/plugin.ts
 */

import { loadPlugins } from './loader.js';
import { logger } from '../utils/logger.js';
import { registerExternalProvider } from '../providers/registry.js';
import type { AgentRole } from '../agents/types.js';
import type { LoadedPlugin, PluginStep, PluginTool } from './types.js';

export class PluginRegistry {
    private plugins: LoadedPlugin[] = [];

    /** Load all plugins from the project's plugins directory and register their providers. */
    async load(projectRoot: string): Promise<void> {
        this.plugins = await loadPlugins(projectRoot);
        for (const plugin of this.plugins) {
            for (const provider of plugin.providers) {
                registerExternalProvider(provider.name, config => provider.create(config));
            }
        }
        if (this.plugins.length > 0) {
            logger.info(`Loaded ${this.plugins.length} plugin(s): ${this.plugins.map(p => p.manifest.name).join(', ')}`);
        }
    }

    /** Plugin tools available to `role`. */
    toolsFor(role: AgentRole): PluginTool[] {
        return this.plugins.flatMap(p => p.tools).filter(t => !t.roles || t.roles.includes(role));
    }

    /** A plugin step by reference, `<plugin-name>/<step-name>`. */
    step(ref: string): PluginStep | undefined {
        const slash = ref.lastIndexOf('/');
        const pluginName = ref.slice(0, slash);
        const stepName = ref.slice(slash + 1);
        return this.plugins.find(p => p.manifest.name === pluginName)?.steps.find(s => s.name === stepName);
    }

    /** Every available step reference, for error messages. */
    stepRefs(): string[] {
        return this.plugins.flatMap(p => p.steps.map(s => `${p.manifest.name}/${s.name}`));
    }

    /** All loaded plugins. */
    list(): LoadedPlugin[] {
        return [...this.plugins];
    }

    get pluginCount(): number {
        return this.plugins.length;
    }
}
