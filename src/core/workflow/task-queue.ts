/**
 * Task queue — manages multiple workflow tasks in sequence.
 *
 * Allows users to feed multiple tasks at once. The queue processes
 * them one by one, tracking results and continuing on failure.
 *
 * Dependency direction: task-queue.ts → workflow/runner, core/errors, utils
 * Used by: cli/commands/run.ts (batch mode)
 */

import chalk from 'chalk';
import { runWorkflow, type RunOptions } from './runner.js';
import type { WorkflowContext } from './engine.js';
import { logger } from '../../utils/logger.js';

/** A task in the queue with its result. */
export interface QueuedTask {
    /** Task description. */
    task: string;
    /** Current status. */
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    /** Workflow context after execution. */
    result?: WorkflowContext;
    /** Error message if failed. */
    error?: string;
    /** Duration in milliseconds. */
    duration?: number;
}

/** Options for running a task queue. */
export interface QueueOptions {
    /** Project root directory. */
    projectRoot: string;
    /** List of task descriptions. */
    tasks: string[];
    /** Skip human approval between tasks. */
    auto?: boolean;
    /** Stop the queue on first failure. */
    stopOnFailure?: boolean;
}

/**
 * Run multiple tasks in sequence.
 *
 * Returns the queue with all results after completion.
 */
export async function runTaskQueue(options: QueueOptions): Promise<QueuedTask[]> {
    const { projectRoot, tasks, auto = false, stopOnFailure = false } = options;

    const queue: QueuedTask[] = tasks.map(task => ({
        task,
        status: 'pending' as const,
    }));

    logger.header('AI Workflow — Task Queue');
    console.log(chalk.gray(`${queue.length} task(s) queued`));
    if (auto) console.log(chalk.yellow('⚡ Autonomous mode'));
    console.log();

    for (let i = 0; i < queue.length; i++) {
        const item = queue[i]!;
        console.log(chalk.bold(`\n── Task ${i + 1}/${queue.length} ──`));
        console.log(chalk.gray(item.task));
        console.log();

        item.status = 'running';
        const startTime = Date.now();

        try {
            const result = await runWorkflow({
                projectRoot,
                task: item.task,
                auto,
            });

            item.result = result;
            item.duration = Date.now() - startTime;

            if (result.state === 'failed') {
                item.status = 'failed';
                item.error = 'Workflow ended in failed state';

                if (stopOnFailure) {
                    // Mark remaining tasks as skipped
                    for (let j = i + 1; j < queue.length; j++) {
                        queue[j]!.status = 'skipped';
                    }
                    break;
                }
            } else {
                item.status = 'completed';
            }
        } catch (err) {
            item.status = 'failed';
            item.error = err instanceof Error ? err.message : String(err);
            item.duration = Date.now() - startTime;

            if (stopOnFailure) {
                for (let j = i + 1; j < queue.length; j++) {
                    queue[j]!.status = 'skipped';
                }
                break;
            }
        }
    }

    // Print queue summary
    printQueueSummary(queue);

    return queue;
}

/**
 * Parse a task list from a file or string.
 * Each line is a separate task. Empty lines and comments (#) are skipped.
 */
export function parseTasks(input: string): string[] {
    return input
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
}

/** Print a colored summary of the queue results. */
function printQueueSummary(queue: QueuedTask[]): void {
    console.log();
    logger.header('Queue Summary');

    const completed = queue.filter(t => t.status === 'completed').length;
    const failed = queue.filter(t => t.status === 'failed').length;
    const skipped = queue.filter(t => t.status === 'skipped').length;

    for (const item of queue) {
        const icon = item.status === 'completed' ? chalk.green('✔')
            : item.status === 'failed' ? chalk.red('✘')
                : item.status === 'skipped' ? chalk.gray('○')
                    : chalk.yellow('…');

        const duration = item.duration ? chalk.gray(` (${(item.duration / 1000).toFixed(1)}s)`) : '';
        console.log(`  ${icon} ${item.task}${duration}`);

        if (item.error) {
            console.log(chalk.red(`    Error: ${item.error}`));
        }
    }

    console.log();
    console.log(chalk.bold(`  ${completed} completed, ${failed} failed, ${skipped} skipped`));
}
