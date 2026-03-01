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
    .option('--stop-on-failure', 'Stop the queue on first failure (batch mode)')
    .option('--context <paths...>', 'Context files to load as reference documents')
    .option('--no-stream', 'Disable real-time streaming of agent output')
    .action(async (task: string, options: { auto?: boolean; batch?: boolean; stopOnFailure?: boolean; context?: string[]; stream: boolean }) => {
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

                const results = await runTaskQueue({
                    projectRoot,
                    tasks,
                    auto: options.auto,
                    stopOnFailure: options.stopOnFailure,
                    contextPaths: options.context,
                });

                const failed = results.filter(t => t.status === 'failed').length;
                if (failed > 0) process.exit(1);
                return;
            }

            // Single task mode
            const result = await runWorkflow({
                projectRoot,
                task,
                auto: options.auto,
                contextPaths: options.context,
                streaming: options.stream,
            });

            if (result.state === 'failed') {
                process.exit(1);
            }
        } catch (err) {
            logger.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });
