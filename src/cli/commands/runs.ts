/**
 * `aiagentflow runs` — list active worktree-based task runs.
 *
 * Shows all worktrees created by aiagentflow, their branch names,
 * session state, and age. Pairs with `discard` and `gc`.
 *
 * Dependency direction: runs.ts → commander, git/worktree, workflow/session, config
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { listWorktrees } from '../../git/worktree.js';
import { listSessions } from '../../core/workflow/session.js';
import { loadConfig, configExists } from '../../core/config/manager.js';
import { logger } from '../../utils/logger.js';

export const runsCommand = new Command('runs')
    .description('List active worktree-based task runs')
    .action(async () => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exit(1);
        }

        const config = loadConfig(projectRoot);
        const worktrees = await listWorktrees(projectRoot, config.workflow.branchPrefix);

        if (worktrees.length === 0) {
            console.log(chalk.gray('No active worktree runs found.'));
            console.log(chalk.gray('Start one with: aiagentflow run --isolate "your task"'));
            return;
        }

        // Index sessions by worktree branch for state lookup
        const sessions = listSessions(projectRoot);
        const sessionByBranch = new Map(
            sessions
                .filter(s => s.worktreeBranch)
                .map(s => [s.worktreeBranch!, s]),
        );

        console.log(chalk.bold(`\n  ${worktrees.length} active run(s)\n`));
        console.log(
            chalk.gray('  ' + ['Branch', 'State', 'Age'].map(h => h.padEnd(36)).join('')),
        );
        console.log(chalk.gray('  ' + '─'.repeat(80)));

        for (const wt of worktrees) {
            const session = sessionByBranch.get(wt.branch);
            const state = session?.context.state ?? 'unknown';
            const createdAt = session?.createdAt;
            const age = createdAt ? formatAge(Date.now() - createdAt) : '?';

            const stateColor = state === 'qa_approved' ? chalk.green
                : state === 'failed' ? chalk.red
                    : chalk.yellow;

            console.log(
                `  ${chalk.cyan(wt.branch.padEnd(36))}${stateColor(state.padEnd(20))}${chalk.gray(age)}`,
            );
        }

        console.log();
        console.log(chalk.gray('  To merge a run:   aiagentflow discard --merge <branch>'));
        console.log(chalk.gray('  To discard a run: aiagentflow discard <branch>'));
        console.log(chalk.gray('  To prune old runs: aiagentflow gc'));
        console.log();
    });

function formatAge(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}
