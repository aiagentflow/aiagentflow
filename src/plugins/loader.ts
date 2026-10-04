/**
 * Plugin loader — resolves and validates plugin modules.
 *
 * Plugins live in `.aiagentflow/plugins/` (local) or can be installed
 * npm packages. The loader imports them, validates the manifest and
 * contributions, and checks for collisions with built-in tools and providers.
 *
 * Dependency direction: plugins/loader.ts → plugins/types, utils/logger
 * Used by: plugins/registry.ts
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { logger } from '../utils/logger.js';
import type { PluginExports, LoadedPlugin } from './types.js';
import { PLUGIN_API_VERSION, RESERVED_PROVIDER_NAMES } from './types.js';
import { BUILTIN_TOOL_NAMES } from '../tools/permissions.js';
import { REMEMBER_TOOL_NAME } from '../memory/tool.js';
import { VERDICT_TOOL_NAME } from '../agents/verdicts.js';

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
        const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8')) as { main?: string };
        entryPath = resolve(pluginPathOrPackage, pkg.main ?? 'index.js');
    } else {
        // npm package — resolve from node_modules
        entryPath = createRequire(join(process.cwd(), 'noop.js')).resolve(pluginPathOrPackage);
    }

    if (!existsSync(entryPath)) {
        throw new Error(`Plugin entry not found: ${entryPath}`);
    }

    const exports = await import(pathToFileURL(entryPath).href) as Partial<PluginExports>;

    if (!exports.manifest) {
        throw new Error(`Plugin at "${entryPath}" does not export a "manifest" object`);
    }

    validatePlugin(exports);

    const pluginDir = pluginPathOrPackage.startsWith('/') || pluginPathOrPackage.startsWith('.')
        ? pluginPathOrPackage
        : entryPath.replace(/\/[^/]+$/, '');

    return {
        manifest: exports.manifest,
        tools: exports.tools ?? [],
        providers: exports.providers ?? [],
        steps: exports.steps ?? [],
        path: pluginDir,
    };
}

/** Tool names owned by aiagentflow; plugin tools cannot reuse them. */
const RESERVED_TOOL_NAMES: readonly string[] = [...BUILTIN_TOOL_NAMES, REMEMBER_TOOL_NAME, VERDICT_TOOL_NAME];

/**
 * Check a plugin's manifest and contributions.
 * @throws {Error} describing the first problem found
 */
export function validatePlugin(exports: Partial<PluginExports>): void {
    const manifest = exports.manifest!;
    const name = typeof manifest.name === 'string' ? manifest.name : '(unnamed)';

    if (!manifest.name || typeof manifest.name !== 'string' || !/^[a-z0-9@][a-z0-9@/._-]*$/.test(manifest.name)) {
        throw new Error('Plugin manifest must have a lowercase "name" (letters, digits, @ / . _ -)');
    }
    if (!manifest.version || typeof manifest.version !== 'string') {
        throw new Error(`Plugin "${name}": manifest must have a "version" string`);
    }
    if (manifest.apiVersion !== PLUGIN_API_VERSION) {
        const v1 = 'type' in manifest ? ' This looks like a v1 plugin (manifest.type, agents with "after"): v2 plugins contribute tools, providers, and workflow steps.' : '';
        throw new Error(`Plugin "${name}": manifest.apiVersion must be ${PLUGIN_API_VERSION}.${v1}`);
    }
    if ('agents' in exports) {
        throw new Error(`Plugin "${name}": "agents" is a v1 contribution. Use a workflow step (steps) or a tool (tools) instead.`);
    }

    for (const tool of exports.tools ?? []) {
        if (!tool?.definition?.name || typeof tool.execute !== 'function') {
            throw new Error(`Plugin "${name}": every tool needs a definition with a name and an execute function`);
        }
        if (RESERVED_TOOL_NAMES.includes(tool.definition.name)) {
            throw new Error(`Plugin "${name}": tool "${tool.definition.name}" is built in. Choose a unique tool name.`);
        }
    }

    for (const provider of exports.providers ?? []) {
        if (!provider?.name || typeof provider.create !== 'function') {
            throw new Error(`Plugin "${name}": every provider needs a name and a create function`);
        }
        if (RESERVED_PROVIDER_NAMES.includes(provider.name as never)) {
            throw new Error(`Plugin "${name}": provider "${provider.name}" is built in. Choose a unique provider name.`);
        }
    }

    for (const step of exports.steps ?? []) {
        if (!step?.name || !/^[a-z][a-z0-9-]*$/.test(step.name) || typeof step.run !== 'function') {
            throw new Error(`Plugin "${name}": every step needs a lowercase name (letters, digits, dashes) and a run function`);
        }
    }
}
