/**
 * `aiagentflow plugin` — manage local and npm plugins.
 *
 * Subcommands:
 *   list    — list installed plugins and their contributions
 *   install — install a plugin from npm or a local path
 *   remove  — uninstall a plugin
 *
 * Dependency direction: plugin.ts → commander, plugins/registry, plugins/loader, config
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { execa } from 'execa';
import { PluginRegistry } from '../../plugins/registry.js';
import { loadPlugin } from '../../plugins/loader.js';
import { configExists } from '../../core/config/manager.js';
import { logger } from '../../utils/logger.js';

const PLUGINS_DIR = '.aiagentflow/plugins';

const pluginList = new Command('list')
    .description('List installed plugins and their contributions')
    .action(async () => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exit(1);
        }

        const registry = new PluginRegistry();
        await registry.load(projectRoot);

        if (registry.pluginCount === 0) {
            console.log(chalk.gray('No plugins installed.'));
            console.log(chalk.gray(`Add plugins to ${PLUGINS_DIR}/ or run "aiagentflow plugin install <package>".`));
            return;
        }

        console.log(chalk.bold(`\n  ${registry.pluginCount} plugin(s) installed\n`));

        for (const plugin of registry.list()) {
            const { manifest } = plugin;
            console.log(`  ${chalk.cyan(manifest.name)} ${chalk.gray(`v${manifest.version}`)}`);
            if (manifest.description) {
                console.log(chalk.gray(`    ${manifest.description}`));
            }

            if (plugin.agents.length > 0) {
                console.log(chalk.gray(`    Agents: ${plugin.agents.map(a => a.role).join(', ')}`));
            }
            if (plugin.providers.length > 0) {
                console.log(chalk.gray(`    Providers: ${plugin.providers.map(p => p.name).join(', ')}`));
            }
            console.log();
        }
    });

const pluginInstall = new Command('install')
    .description('Install a plugin from npm or a local path')
    .argument('<source>', 'npm package name or local path to plugin directory')
    .action(async (source: string) => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exit(1);
        }

        const pluginsDir = join(projectRoot, PLUGINS_DIR);
        mkdirSync(pluginsDir, { recursive: true });

        const isLocalPath = source.startsWith('.') || source.startsWith('/');

        if (isLocalPath) {
            // Symlink a local plugin directory into the plugins folder
            const absoluteSource = resolve(process.cwd(), source);
            if (!existsSync(absoluteSource)) {
                logger.error(`Local path not found: ${absoluteSource}`);
                process.exit(1);
            }

            // Validate it's a valid plugin before linking
            try {
                await loadPlugin(absoluteSource);
            } catch (err) {
                logger.error(`Invalid plugin: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }

            const linkName = basename(absoluteSource);
            const linkPath = join(pluginsDir, linkName);

            if (existsSync(linkPath)) {
                logger.warn(`Plugin "${linkName}" is already installed. Remove it first with "aiagentflow plugin remove ${linkName}".`);
                process.exit(1);
            }

            symlinkSync(absoluteSource, linkPath);
            logger.success(`Plugin linked: ${linkName} → ${absoluteSource}`);
        } else {
            // npm install into the plugins directory
            console.log(chalk.gray(`Installing ${source} from npm...`));
            try {
                await execa('npm', ['install', '--prefix', pluginsDir, source], {
                    cwd: projectRoot,
                    stdio: 'inherit',
                });

                // Validate the installed package
                const packagePath = join(pluginsDir, 'node_modules', source);
                await loadPlugin(packagePath);
                logger.success(`Plugin installed: ${source}`);
            } catch (err) {
                logger.error(`Failed to install plugin: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        }
    });

const pluginRemove = new Command('remove')
    .description('Remove an installed plugin')
    .argument('<name>', 'Plugin name (as shown in "aiagentflow plugin list")')
    .action(async (name: string) => {
        const projectRoot = process.cwd();
        const pluginsDir = join(projectRoot, PLUGINS_DIR);
        const pluginPath = join(pluginsDir, name);

        if (!existsSync(pluginPath)) {
            // Also try node_modules (npm-installed)
            const npmPath = join(pluginsDir, 'node_modules', name);
            if (!existsSync(npmPath)) {
                logger.error(`Plugin "${name}" not found.`);
                process.exit(1);
            }

            try {
                await execa('npm', ['uninstall', '--prefix', pluginsDir, name], {
                    cwd: projectRoot,
                    stdio: 'inherit',
                });
                logger.success(`Plugin removed: ${name}`);
            } catch (err) {
                logger.error(`Failed to remove plugin: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
            return;
        }

        rmSync(pluginPath, { recursive: true, force: true });
        logger.success(`Plugin removed: ${name}`);
    });

export const pluginCommand = new Command('plugin')
    .description('Manage aiagentflow plugins')
    .addCommand(pluginList)
    .addCommand(pluginInstall)
    .addCommand(pluginRemove);
