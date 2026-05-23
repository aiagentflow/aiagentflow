/**
 * `aiagentflow run` — Execute a workflow task or batch of tasks.
 *
 * Supports single tasks, batch mode from a file, and autonomous mode.
 *
 * Dependency direction: run.ts → commander, workflow/runner, task-queue, config
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { configExists } from '../../core/config/manager.js';
import { runWorkflow } from '../../core/workflow/runner.js';
import { runTaskQueue, parseTasks } from '../../core/workflow/task-queue.js';
import { logger } from '../../utils/logger.js';

export const runCommand = new Command('run')
    .description('Run an AI workflow task')
    .argument('<task>', 'Task description or path to a task list file (.txt)')
    .option('--auto', 'Autonomous mode — skip all human approval gates')
    .option('--batch', 'Treat the argument as a task list file (one task per line)')
    .option('--mode <mode>', 'Workflow mode override: fast, balanced, or strict')
    .option('--stop-on-failure', 'Stop the queue on first failure (batch mode)')
    .option('--context <paths...>', 'Context files to load as reference documents')
    .option('--no-stream', 'Disable real-time streaming of agent output')
    .option('--dry-run', 'Preview the workflow plan without executing agents')
    .option('--isolate', 'Run in an isolated git worktree (overrides config)')
    .option('--no-isolate', 'Run in-place without a worktree (overrides config)')
    .option('--review-plan', 'Pause for plan approval after the Architect runs')
    .option('--approval-gates <roles...>', 'Agent roles that require explicit approval (e.g. architect coder)')
    .option('--parallel <n>', 'Run batch tasks N at a time in parallel worktrees (batch mode only)', parseInt)
    .option('--max-tokens <n>', 'Abort remaining tasks if total token budget is exceeded (batch mode)', parseInt)
    .option('--max-cost <usd>', 'Abort remaining tasks if estimated USD cost is exceeded (batch mode)', parseFloat)
    .option('--no-summary', 'Suppress the token/cost summary at the end of the run')
    .action(async (task: string, options: { auto?: boolean; batch?: boolean; mode?: string; stopOnFailure?: boolean; context?: string[]; stream: boolean; dryRun?: boolean; isolate?: boolean; reviewPlan?: boolean; approvalGates?: string[]; parallel?: number; maxTokens?: number; maxCost?: number; summary: boolean }) => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exit(1);
        }

        try {
            // Batch mode: read tasks from file
            if (options.batch || task.endsWith('.txt')) {
                if (!existsSync(task)) {
                    logger.error(`Task list file not found: ${task}`);
                    process.exit(1);
                }

                const content = readFileSync(task, 'utf-8');
                const tasks = parseTasks(content);

                if (tasks.length === 0) {
                    logger.error('No tasks found in file. Each line should be a task description.');
                    process.exit(1);
                }

                const isolation = options.isolate === true ? 'worktree'
                    : options.isolate === false ? 'inplace'
                        : undefined;

                const budget = (options.maxTokens || options.maxCost) ? {
                    maxTokens: options.maxTokens,
                    maxCostUsd: options.maxCost,
                } : undefined;

                const results = await runTaskQueue({
                    projectRoot,
                    tasks,
                    auto: options.auto,
                    mode: options.mode,
                    stopOnFailure: options.stopOnFailure,
                    contextPaths: options.context,
                    dryRun: options.dryRun,
                    parallel: options.parallel,
                    isolation,
                    budget,
                });

                const failed = results.filter(t => t.status === 'failed').length;
                if (failed > 0) process.exit(1);
                return;
            }

            // Resolve isolation override (--isolate → 'worktree', --no-isolate → 'inplace')
            const isolation = options.isolate === true ? 'worktree'
                : options.isolate === false ? 'inplace'
                    : undefined;

            // Resolve approval gates — --review-plan is shorthand for gating the architect
            const approvalGates = options.approvalGates
                ?? (options.reviewPlan ? ['architect'] : undefined);

            // Single task mode
            const result = await runWorkflow({
                projectRoot,
                task,
                auto: options.auto,
                mode: options.mode,
                contextPaths: options.context,
                streaming: options.stream,
                dryRun: options.dryRun,
                isolation,
                approvalGates,
                showSummary: options.summary !== false,
            });

            if (result.state === 'failed') {
                process.exit(1);
            }
        } catch (err) {
            logger.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });
