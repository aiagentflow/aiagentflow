/**
 * `aiagentflow sessions` — List saved workflow sessions.
 *
 * Shows all sessions with their state, task, and timestamps.
 * Useful for finding a session ID to resume.
 *
 * Dependency direction: sessions.ts → commander, session, engine, utils
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { listSessions } from '../../core/workflow/session.js';
import { isTerminal, runLabel } from '../../core/workflow/engine.js';
import { logger } from '../../utils/logger.js';

export const sessionsCommand = new Command('sessions')
    .description('List saved workflow sessions')
    .action(() => {
        const projectRoot = process.cwd();
        const sessions = listSessions(projectRoot);

        if (sessions.length === 0) {
            logger.info('No sessions found.');
            return;
        }

        logger.header('Saved Sessions');
        console.log();

        for (const session of sessions) {
            const { id, context, createdAt, updatedAt } = session;
            const duration = formatDuration(updatedAt - createdAt);
            const updated = new Date(updatedAt).toLocaleString();
            const taskPreview = context.task.length > 60
                ? context.task.slice(0, 57) + '...'
                : context.task;

            const label = runLabel(context);
            const stateLabel = context.status === 'passed'
                ? chalk.green(label)
                : context.status === 'failed'
                    ? chalk.red(label)
                    : chalk.yellow(label) + chalk.gray(' (resumable)');

            console.log(`  ${chalk.bold(id)}`);
            console.log(chalk.gray(`    Task:     ${taskPreview}`));
            console.log(chalk.gray(`    Workflow: ${context.workflow}`));
            console.log(chalk.gray(`    Status:   `) + stateLabel);
            console.log(chalk.gray(`    Updated:  ${updated}`));
            console.log(chalk.gray(`    Duration: ${duration}`));
            console.log();
        }

        const resumable = sessions.filter(s => !isTerminal(s.context)).length;
        if (resumable > 0) {
            console.log(chalk.gray(`  ${resumable} session(s) can be resumed with: aiagentflow resume [session-id]`));
        }
    });

function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes < 60) return `${minutes}m ${secs}s`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
}
