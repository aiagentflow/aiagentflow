/**
 * `ai-workflow run` — Execute a workflow task.
 *
 * Orchestrates the full agent pipeline for a given task.
 *
 * Dependency direction: run.ts → commander, workflow/runner, config/manager
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import { configExists } from '../../core/config/manager.js';
import { runWorkflow } from '../../core/workflow/runner.js';
import { logger } from '../../utils/logger.js';

export const runCommand = new Command('run')
    .description('Run an AI workflow task')
    .argument('<task>', 'Task description or path to spec file')
    .option('--auto', 'Autonomous mode — skip all human approval gates')
    .action(async (task: string, options: { auto?: boolean }) => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "ai-workflow init" first.');
            process.exit(1);
        }

        try {
            const result = await runWorkflow({
                projectRoot,
                task,
                auto: options.auto,
            });

            if (result.state === 'failed') {
                process.exit(1);
            }
        } catch (err) {
            logger.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });
