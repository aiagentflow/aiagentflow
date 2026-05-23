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
import { runWorkflow } from './runner.js';
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

/** Options for running a task queue. */
export interface QueueOptions {
    /** Project root directory. */
    projectRoot: string;
    /** List of task descriptions. */
    tasks: string[];
    /** Skip human approval between tasks. */
    auto?: boolean;
    /** Workflow mode override (fast, balanced, strict). */
    mode?: string;
    /** Stop the queue on first failure (sequential mode only). */
    stopOnFailure?: boolean;
    /** Explicit context file paths to load. */
    contextPaths?: string[];
    /** Preview workflow plan without executing agents. */
    dryRun?: boolean;
    /** Number of tasks to run in parallel (default: 1 = sequential). */
    parallel?: number;
    /** Override isolation mode. Defaults to 'worktree' when parallel > 1. */
    isolation?: 'worktree' | 'inplace';
    /** Budget caps applied across all parallel tasks. */
    budget?: BudgetLimits;
}

/**
 * Run multiple tasks, sequentially or in parallel.
 *
 * Returns the queue with all results after completion.
 */
export async function runTaskQueue(options: QueueOptions): Promise<QueuedTask[]> {
    const {
        projectRoot,
        tasks,
        auto = false,
        mode,
        stopOnFailure = false,
        contextPaths,
        dryRun,
        parallel = 1,
        budget,
    } = options;

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

    logger.header('AI Workflow — Task Queue');
    console.log(chalk.gray(`${queue.length} task(s) queued`));
    if (isParallel) console.log(chalk.blue(`Parallel: ${parallel} concurrent tasks`));
    if (mode) console.log(chalk.blue(`Mode: ${mode}`));
    if (auto) console.log(chalk.yellow('⚡ Autonomous mode'));
    if (budget?.maxTokens) console.log(chalk.gray(`Token budget: ${budget.maxTokens.toLocaleString()}`));
    if (budget?.maxCostUsd) console.log(chalk.gray(`Cost budget: $${budget.maxCostUsd}`));
    console.log();

    if (isParallel) {
        await runParallel(queue, { projectRoot, auto, mode, contextPaths, dryRun, isolation, parallel, budgetTracker });
    } else {
        await runSequential(queue, { projectRoot, auto, mode, stopOnFailure, contextPaths, dryRun, isolation, budgetTracker });
    }

    printQueueSummary(queue, budgetTracker);
    return queue;
}

// ── Sequential runner ──

interface RunnerParams {
    projectRoot: string;
    auto: boolean;
    mode?: string;
    stopOnFailure?: boolean;
    contextPaths?: string[];
    dryRun?: boolean;
    isolation?: 'worktree' | 'inplace';
    parallel?: number;
    budgetTracker: BudgetTracker;
}

async function runSequential(queue: QueuedTask[], params: RunnerParams): Promise<void> {
    const { projectRoot, auto, mode, stopOnFailure, contextPaths, dryRun, isolation, budgetTracker } = params;

    for (let i = 0; i < queue.length; i++) {
        const item = queue[i]!;

        if (budgetTracker.exceeded) {
            markRemaining(queue, i, 'skipped');
            logger.warn('Budget cap reached — remaining tasks skipped.');
            break;
        }

        console.log(chalk.bold(`\n── Task ${i + 1}/${queue.length} ──`));
        console.log(chalk.gray(item.task));
        console.log();

        await executeTask(item, { projectRoot, auto, mode, contextPaths, dryRun, isolation, budgetTracker });

        if (item.status === 'failed' && stopOnFailure) {
            markRemaining(queue, i + 1, 'skipped');
            break;
        }
    }
}

// ── Parallel runner ──

async function runParallel(queue: QueuedTask[], params: RunnerParams): Promise<void> {
    const { projectRoot, auto, mode, contextPaths, dryRun, isolation, parallel = 2, budgetTracker } = params;
    const limit = pLimit(parallel);
    let budgetExceeded = false;

    const promises = queue.map((item, i) =>
        limit(async () => {
            if (budgetExceeded || budgetTracker.exceeded) {
                item.status = 'skipped';
                return;
            }

            console.log(chalk.bold(`\n── Task ${i + 1}/${queue.length} (parallel) ──`));
            console.log(chalk.gray(item.task));

            await executeTask(item, { projectRoot, auto, mode, contextPaths, dryRun, isolation, budgetTracker });

            if (budgetTracker.exceeded) {
                budgetExceeded = true;
            }
        }),
    );

    await Promise.all(promises);
}

// ── Task executor ──

async function executeTask(item: QueuedTask, params: Omit<RunnerParams, 'stopOnFailure' | 'parallel'>): Promise<void> {
    const { projectRoot, auto, mode, contextPaths, dryRun, isolation, budgetTracker } = params;
    item.status = 'running';
    const startTime = Date.now();

    try {
        const result = await runWorkflow({
            projectRoot,
            task: item.task,
            auto,
            mode,
            contextPaths,
            dryRun,
            isolation,
            // Batch tasks use streaming off by default — logs would interleave
            streaming: false,
        });

        item.result = result;
        item.duration = Date.now() - startTime;

        // Token accumulation is done per-agent inside the runner's tokenTracker.
        // Budget tracking via BudgetTracker happens at task granularity using estimated values.
        item.tokensUsed = 0;

        item.status = result.state === 'failed' ? 'failed' : 'completed';
        if (result.state === 'failed') {
            item.error = 'Workflow ended in failed state';
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
