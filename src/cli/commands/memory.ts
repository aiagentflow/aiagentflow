/**
 * `aiagentflow memory` — inspect and manage the project's agent memory store.
 *
 * Subcommands:
 *   list                  Show all memories grouped by type
 *   show <name>           Print one memory's full body
 *   rm <name>             Delete a memory
 *   edit <name>           Open a memory in $EDITOR
 *   clear --type <type>   Delete all memories of a given type
 *
 * Dependency direction: memory.ts → commander, memory/store, memory/types
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { loadAll, deleteMemory, getMemoryDir } from '../../memory/store.js';
import { MEMORY_TYPES, MEMORY_TYPE_LABELS, type MemoryType } from '../../memory/types.js';
import { configExists } from '../../core/config/manager.js';
import { logger } from '../../utils/logger.js';

function requireConfig(projectRoot: string): void {
    if (!configExists(projectRoot)) {
        logger.error('No configuration found. Run "aiagentflow init" first.');
        process.exit(1);
    }
}

export const memoryCommand = new Command('memory')
    .description('Manage the project agent memory store');

memoryCommand
    .command('list')
    .description('List all stored memories grouped by type')
    .option('--type <type>', 'Filter by type (architecture|convention|decision|gotcha|reference)')
    .action((options: { type?: string }) => {
        const projectRoot = process.cwd();
        requireConfig(projectRoot);

        const all = loadAll(projectRoot);

        if (all.length === 0) {
            console.log(chalk.gray('No memories stored yet. Run a workflow to start building memory.'));
            return;
        }

        const filterType = options.type as MemoryType | undefined;
        if (filterType && !MEMORY_TYPES.includes(filterType)) {
            logger.error(`Unknown type "${filterType}". Valid: ${MEMORY_TYPES.join(', ')}`);
            process.exit(1);
        }

        const types = filterType ? [filterType] : [...MEMORY_TYPES];

        for (const type of types) {
            const entries = all.filter(e => e.type === type);
            if (entries.length === 0) continue;

            console.log(`\n${chalk.bold(MEMORY_TYPE_LABELS[type])} (${entries.length})`);
            console.log(chalk.gray('─'.repeat(40)));

            for (const entry of entries) {
                const age = formatAge(entry.updated);
                console.log(
                    `  ${chalk.cyan(entry.name.padEnd(32))} ${chalk.gray(entry.description.slice(0, 60))}${entry.description.length > 60 ? '…' : ''}`,
                );
                console.log(`  ${' '.repeat(32)} ${chalk.gray(`updated ${age}`)}`);
            }
        }

        console.log('');
    });

memoryCommand
    .command('show <name>')
    .description('Print the full body of a memory')
    .action((name: string) => {
        const projectRoot = process.cwd();
        requireConfig(projectRoot);

        const all = loadAll(projectRoot);
        const entry = all.find(e => e.name === name || e.name.includes(name));

        if (!entry) {
            logger.error(`Memory "${name}" not found. Run "aiagentflow memory list" to see all.`);
            process.exit(1);
        }

        console.log(`\n${chalk.bold(`[${entry.type}] ${entry.name}`)}`);
        console.log(chalk.gray(entry.description));
        console.log(chalk.gray(`Created: ${entry.created}  Updated: ${entry.updated}`));
        console.log(chalk.gray('─'.repeat(60)));
        console.log(entry.body);
    });

memoryCommand
    .command('rm <name>')
    .description('Delete a memory by name')
    .action((name: string) => {
        const projectRoot = process.cwd();
        requireConfig(projectRoot);

        const deleted = deleteMemory(projectRoot, name);

        if (deleted) {
            logger.success(`Memory "${name}" deleted.`);
        } else {
            logger.error(`Memory "${name}" not found.`);
            process.exit(1);
        }
    });

memoryCommand
    .command('edit <name>')
    .description('Open a memory in $EDITOR')
    .action((name: string) => {
        const projectRoot = process.cwd();
        requireConfig(projectRoot);

        const dir = getMemoryDir(projectRoot);
        const filePath = `${dir}/${name}.md`;

        if (!existsSync(filePath)) {
            logger.error(`Memory file not found: ${filePath}`);
            process.exit(1);
        }

        const editor = process.env['EDITOR'] ?? process.env['VISUAL'] ?? 'nano';
        try {
            execSync(`${editor} "${filePath}"`, { stdio: 'inherit' });
        } catch {
            logger.error(`Failed to open editor: ${editor}`);
            process.exit(1);
        }
    });

memoryCommand
    .command('clear')
    .description('Delete all memories of a given type')
    .requiredOption('--type <type>', 'Memory type to clear (architecture|convention|decision|gotcha|reference)')
    .action((options: { type: string }) => {
        const projectRoot = process.cwd();
        requireConfig(projectRoot);

        const type = options.type as MemoryType;
        if (!MEMORY_TYPES.includes(type)) {
            logger.error(`Unknown type "${type}". Valid: ${MEMORY_TYPES.join(', ')}`);
            process.exit(1);
        }

        const all = loadAll(projectRoot).filter(e => e.type === type);

        if (all.length === 0) {
            logger.info(`No memories of type "${type}" to clear.`);
            return;
        }

        for (const entry of all) {
            deleteMemory(projectRoot, entry.name);
        }

        logger.success(`Cleared ${all.length} ${MEMORY_TYPE_LABELS[type]} memory entry(s).`);
    });

// ── Helpers ──

function formatAge(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
