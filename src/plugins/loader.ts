/**
 * Plugin loader — resolves and validates plugin modules.
 *
 * Plugins live in `.aiagentflow/plugins/` (local) or can be installed
 * npm packages. The loader imports them, validates the manifest, and
 * checks for name collisions with built-in roles/providers.
 *
 * Dependency direction: plugins/loader.ts → plugins/types, utils/logger
 * Used by: plugins/registry.ts
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from '../utils/logger.js';
import type { PluginExports, LoadedPlugin } from './types.js';
import { RESERVED_AGENT_ROLES, RESERVED_PROVIDER_NAMES } from './types.js';

const PLUGINS_DIR = '.aiagentflow/plugins';

/**
 * Load all plugins from the project's plugins directory.
 * Each subdirectory (or symlink) is treated as a plugin package.
 */
export async function loadPlugins(projectRoot: string): Promise<LoadedPlugin[]> {
    const pluginsDir = join(projectRoot, PLUGINS_DIR);
    if (!existsSync(pluginsDir)) return [];

    const entries = readdirSync(pluginsDir);
    const loaded: LoadedPlugin[] = [];

    for (const entry of entries) {
        const pluginPath = join(pluginsDir, entry);
        if (!statSync(pluginPath).isDirectory()) continue;

        try {
            const plugin = await loadPlugin(pluginPath);
            if (plugin) loaded.push(plugin);
        } catch (err) {
            logger.warn(`Failed to load plugin "${entry}": ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    return loaded;
}

/**
 * Load a single plugin from an absolute directory path or npm package name.
 */
export async function loadPlugin(pluginPathOrPackage: string): Promise<LoadedPlugin | null> {
    let entryPath: string;

    if (pluginPathOrPackage.startsWith('/') || pluginPathOrPackage.startsWith('.')) {
        // Local path
        const pkgJson = join(pluginPathOrPackage, 'package.json');
        if (!existsSync(pkgJson)) {
            throw new Error(`No package.json found at ${pluginPathOrPackage}`);
        }
        const pkg = JSON.parse(require('node:fs').readFileSync(pkgJson, 'utf-8')) as { main?: string };
        entryPath = resolve(pluginPathOrPackage, pkg.main ?? 'index.js');
    } else {
        // npm package — resolve from node_modules
        entryPath = require.resolve(pluginPathOrPackage);
    }

    if (!existsSync(entryPath)) {
        throw new Error(`Plugin entry not found: ${entryPath}`);
    }

    const exports = await import(entryPath) as Partial<PluginExports>;

    if (!exports.manifest) {
        throw new Error(`Plugin at "${entryPath}" does not export a "manifest" object`);
    }

    validateManifest(exports);

    const pluginDir = pluginPathOrPackage.startsWith('/') || pluginPathOrPackage.startsWith('.')
        ? pluginPathOrPackage
        : entryPath.replace(/\/[^/]+$/, '');

    return {
        manifest: exports.manifest,
        agents: exports.agents ?? [],
        providers: exports.providers ?? [],
        path: pluginDir,
    };
}

function validateManifest(exports: Partial<PluginExports>): void {
    const manifest = exports.manifest!;

    if (!manifest.name || typeof manifest.name !== 'string') {
        throw new Error('Plugin manifest must have a "name" string field');
    }
    if (!manifest.version || typeof manifest.version !== 'string') {
        throw new Error('Plugin manifest must have a "version" string field');
    }
    if (!['agent', 'provider', 'both'].includes(manifest.type)) {
        throw new Error('Plugin manifest "type" must be "agent", "provider", or "both"');
    }

    // Check for name collisions
    for (const agent of exports.agents ?? []) {
        if (RESERVED_AGENT_ROLES.includes(agent.role)) {
            throw new Error(
                `Plugin "${manifest.name}" tries to register role "${agent.role}" which is a built-in role. ` +
                'Choose a unique role name.',
            );
        }
    }

    for (const provider of exports.providers ?? []) {
        if (RESERVED_PROVIDER_NAMES.includes(provider.name as never)) {
            throw new Error(
                `Plugin "${manifest.name}" tries to register provider "${provider.name}" which is built-in. ` +
                'Choose a unique provider name.',
            );
        }
    }
}
