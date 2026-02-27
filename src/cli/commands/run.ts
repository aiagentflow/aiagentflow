/**
 * `ai-workflow run` — Execute a workflow task (stub for Phase 2).
 *
 * Dependency direction: run.ts → commander
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { configExists } from '../../core/config/manager.js';
import { logger } from '../../utils/logger.js';

export const runCommand = new Command('run')
    .description('Run an AI workflow task')
    .argument('<task>', 'Task description or path to spec file')
    .action((task: string) => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "ai-workflow init" first.');
            process.exit(1);
        }

        logger.header('AI Workflow — Run Task');
        console.log(chalk.gray(`Task: ${task}`));
        console.log();
        console.log(chalk.yellow('⚠ The workflow engine is coming in Phase 2.'));
        console.log(chalk.gray('  This command will orchestrate: Architect → Coder → Reviewer → Tester → Fixer → Judge'));
        console.log();
    });
