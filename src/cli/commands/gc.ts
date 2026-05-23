/**
 * `aiagentflow gc` — prune stale worktree runs older than a threshold.
 *
 * Dependency direction: gc.ts → commander, git/worktree, config
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import { pruneStaleWorktrees } from '../../git/worktree.js';
import { loadConfig, configExists } from '../../core/config/manager.js';
import { logger } from '../../utils/logger.js';

const DEFAULT_MAX_AGE_DAYS = 7;

export const gcCommand = new Command('gc')
    .description('Prune stale worktree runs older than a threshold')
    .option('--max-age <days>', 'Maximum age in days before pruning (default: 7)', String(DEFAULT_MAX_AGE_DAYS))
    .option('--dry-run', 'Show what would be pruned without deleting')
    .action(async (options: { maxAge: string; dryRun?: boolean }) => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exit(1);
        }

        const config = loadConfig(projectRoot);
        const maxAgeDays = parseFloat(options.maxAge) || DEFAULT_MAX_AGE_DAYS;
        const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

        if (options.dryRun) {
            const { listWorktrees } = await import('../../git/worktree.js');
            const worktrees = await listWorktrees(projectRoot, config.workflow.branchPrefix);
            const stale = worktrees.filter(wt => {
                const parts = wt.branch.split('-');
                const tsBase36 = parts[parts.length - 1];
                if (!tsBase36) return false;
                const ts = parseInt(tsBase36, 36);
                return !isNaN(ts) && Date.now() - ts > maxAgeMs;
            });

            if (stale.length === 0) {
                logger.info(`No worktrees older than ${maxAgeDays} days.`);
            } else {
                logger.info(`Would prune ${stale.length} worktree(s):`);
                for (const wt of stale) {
                    console.log(`  ${wt.branch}`);
                }
            }
            return;
        }

        const pruned = await pruneStaleWorktrees(projectRoot, config.workflow.branchPrefix, maxAgeMs);

        if (pruned === 0) {
            logger.info(`No worktrees older than ${maxAgeDays} days to prune.`);
        } else {
            logger.success(`Pruned ${pruned} stale worktree(s).`);
        }
    });
