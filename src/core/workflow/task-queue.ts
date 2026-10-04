/**
 * Task queue — manages multiple workflow tasks sequentially or in parallel.
 *
 * With --parallel N, up to N tasks run concurrently, each in its own worktree.
 * A shared BudgetTracker caps total token/cost spend across all tasks.
 *
 * Dependency direction: task-queue.ts → workflow/runner, budget-tracker, utils
 * Used by: cli/commands/run.ts (batch mode)
 */

import pLimit from 'p-limit';
import chalk from 'chalk';
import { runWorkflow, type RunOptions } from './runner.js';
import { BudgetTracker, type BudgetLimits } from './budget-tracker.js';
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
    /** Total tokens used by this task. */
    tokensUsed?: number;
}

/** Run options shared by every task in the queue. */
export type SharedRunOptions = Pick<RunOptions, 'workflow' | 'events' | 'auto' | 'headless' | 'mode' | 'contextPaths' | 'dryRun' | 'isolation'>;

/** Options for running a task queue. */
export interface QueueOptions extends SharedRunOptions {
    /** Project root directory. */
    projectRoot: string;
    /** List of task descriptions. */
    tasks: string[];
    /** Stop the queue on first failure (sequential mode only). */
    stopOnFailure?: boolean;
    /** Number of tasks to run in parallel (default: 1 = sequential). */
    parallel?: number;
    /** Budget caps applied across all tasks. Each task gets what is left. */
    budget?: BudgetLimits;
}

/**
 * Run multiple tasks, sequentially or in parallel.
 *
 * Returns the queue with all results after completion.
 */
export async function runTaskQueue(options: QueueOptions): Promise<QueuedTask[]> {
    const { projectRoot, tasks, stopOnFailure = false, parallel = 1, budget, ...shared } = options;

    // When parallel > 1, default to worktree isolation so tasks don't clobber each other
    const isolation = options.isolation ?? (parallel > 1 ? 'worktree' : undefined);

    if (parallel > 1 && isolation !== 'worktree') {
        logger.warn('Running parallel tasks without worktree isolation — file writes may conflict.');
    }

    const queue: QueuedTask[] = tasks.map(task => ({
        task,
        status: 'pending' as const,
    }));

    const budgetTracker = new BudgetTracker(budget ?? {});
    const isParallel = parallel > 1;
    const run: RunnerParams = { projectRoot, shared: { ...shared, isolation }, budgetTracker };

    logger.header('AI Workflow — Task Queue');
    console.log(chalk.gray(`${queue.length} task(s) queued`));
    if (isParallel) console.log(chalk.blue(`Parallel: ${parallel} concurrent tasks`));
    if (shared.mode) console.log(chalk.blue(`Mode: ${shared.mode}`));
    if (shared.auto || shared.headless) console.log(chalk.yellow('⚡ Autonomous mode'));
    if (budget?.maxTokens) console.log(chalk.gray(`Token budget: ${budget.maxTokens.toLocaleString()}`));
    if (budget?.maxCostUsd) console.log(chalk.gray(`Cost budget: $${budget.maxCostUsd}`));
    if (budget?.maxTimeMs) console.log(chalk.gray(`Time budget: ${Math.round(budget.maxTimeMs / 60_000)} min`));
    console.log();

    if (isParallel) {
        await runParallel(queue, run, parallel);
    } else {
        await runSequential(queue, run, stopOnFailure);
    }

    printQueueSummary(queue, budgetTracker);

    return queue;
}

// ── Sequential runner ──

interface RunnerParams {
    projectRoot: string;
    shared: SharedRunOptions;
    budgetTracker: BudgetTracker;
}

async function runSequential(queue: QueuedTask[], params: RunnerParams, stopOnFailure: boolean): Promise<void> {
    for (let i = 0; i < queue.length; i++) {
        const item = queue[i]!;

        if (params.budgetTracker.exceeded) {
            markRemaining(queue, i, 'skipped');
            logger.warn(`${params.budgetTracker.exceededReason} — remaining tasks skipped.`);
            break;
        }

        console.log(chalk.bold(`\n── Task ${i + 1}/${queue.length} ──`));
        console.log(chalk.gray(item.task));
        console.log();

        await executeTask(item, params);

        if (item.status === 'failed' && stopOnFailure) {
            markRemaining(queue, i + 1, 'skipped');
            break;
        }
    }
}

// ── Parallel runner ──

async function runParallel(queue: QueuedTask[], params: RunnerParams, parallel: number): Promise<void> {
    const limit = pLimit(parallel);

    const promises = queue.map((item, i) =>
        limit(async () => {
            if (params.budgetTracker.exceeded) {
                item.status = 'skipped';
                return;
            }

            console.log(chalk.bold(`\n── Task ${i + 1}/${queue.length} (parallel) ──`));
            console.log(chalk.gray(item.task));

            await executeTask(item, params);
        }),
    );

    await Promise.all(promises);
}

// ── Task executor ──

async function executeTask(item: QueuedTask, params: RunnerParams): Promise<void> {
    item.status = 'running';
    const startTime = Date.now();
    const hasBudget = Object.keys(params.budgetTracker.limits).length > 0;

    try {
        const result = await runWorkflow({
            ...params.shared,
            projectRoot: params.projectRoot,
            task: item.task,
            // Each task may spend what the queue has left (parallel tasks share the same remainder)
            ...(hasBudget ? { budget: params.budgetTracker.remaining } : {}),
            // Batch tasks use streaming off by default — logs would interleave
            streaming: false,
        });

        item.result = result;
        item.duration = Date.now() - startTime;
        item.tokensUsed = result.usage?.totalTokens ?? 0;
        params.budgetTracker.record(item.tokensUsed, result.usage?.costUsd ?? 0);

        item.status = result.status === 'failed' ? 'failed' : 'completed';
        if (result.status === 'failed') {
            item.error = result.failureReason ?? 'Workflow failed';
        }
    } catch (err) {
        item.status = 'failed';
        item.error = err instanceof Error ? err.message : String(err);
        item.duration = Date.now() - startTime;
    }
}

// ── Helpers ──

function markRemaining(queue: QueuedTask[], fromIndex: number, status: QueuedTask['status']): void {
    for (let j = fromIndex; j < queue.length; j++) {
        if (queue[j]!.status === 'pending') {
            queue[j]!.status = status;
        }
    }
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
function printQueueSummary(queue: QueuedTask[], budgetTracker: BudgetTracker): void {
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

    if (budgetTracker.tokens > 0) {
        console.log(chalk.gray(`  Total: ${budgetTracker.summary()}`));
    }
}
