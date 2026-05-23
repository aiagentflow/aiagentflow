/**
 * `aiagentflow discard` — remove a worktree run (optionally merging first).
 *
 * Dependency direction: discard.ts → commander, git/worktree, config
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { removeWorktree, mergeBranch, listWorktrees } from '../../git/worktree.js';
import { loadConfig, configExists } from '../../core/config/manager.js';
import { logger } from '../../utils/logger.js';

export const discardCommand = new Command('discard')
    .description('Remove a worktree run, optionally merging it first')
    .argument('[branch]', 'Branch name to discard (omit to pick from list)')
    .option('--merge', 'Merge the branch into the current branch before removing')
    .action(async (branch: string | undefined, options: { merge?: boolean }) => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exit(1);
        }

        const config = loadConfig(projectRoot);
        const worktrees = await listWorktrees(projectRoot, config.workflow.branchPrefix);

        if (worktrees.length === 0) {
            logger.info('No active worktree runs found.');
            return;
        }

        let target = branch;

        if (!target) {
            const { default: prompts } = await import('prompts');
            const { chosen } = await prompts({
                type: 'select',
                name: 'chosen',
                message: 'Which worktree run do you want to discard?',
                choices: worktrees.map(wt => ({
                    title: wt.branch,
                    value: wt.branch,
                })),
            });
            if (!chosen) return;
            target = chosen as string;
        }

        const wt = worktrees.find(w => w.branch === target);
        if (!wt) {
            logger.error(`Worktree not found for branch: ${target}`);
            process.exit(1);
        }

        if (options.merge) {
            console.log(chalk.gray(`Merging ${target} into current branch…`));
            try {
                await mergeBranch(projectRoot, target);
                logger.success(`Merged ${target}`);
            } catch (err) {
                logger.error(`Merge failed: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        }

        await removeWorktree(projectRoot, wt.path, target);
        logger.success(`Discarded worktree: ${target}`);
    });
