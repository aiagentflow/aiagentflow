/**
 * `aiagentflow plan` — Generate a task list from documentation.
 *
 * Reads docs (PRDs, specs, etc.), sends them to the architect agent
 * with a breakdown prompt, and outputs one task per line — compatible
 * with `--batch` mode.
 *
 * Dependency direction: plan.ts → commander, context-loader, agents, config
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import { existsSync, writeFileSync } from 'node:fs';
import ora from 'ora';
import chalk from 'chalk';
import { configExists, loadConfig } from '../../core/config/manager.js';
import { loadContextDocuments, formatContextForAgent } from '../../core/workflow/context-loader.js';
import { createAgent } from '../../agents/factory.js';
import { logger } from '../../utils/logger.js';

export const planCommand = new Command('plan')
    .description('Generate a task list from documentation files')
    .argument('<docs...>', 'Documentation files to analyze (PRDs, specs, etc.)')
    .option('-o, --output <file>', 'Write task list to file (default: stdout)')
    .option('--context <paths...>', 'Additional context files to include')
    .option('--numbered', 'Prefix each task with a number')
    .option('--no-stream', 'Disable streaming output')
    .action(async (docs: string[], options: { output?: string; context?: string[]; numbered?: boolean; stream: boolean }) => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exit(1);
        }

        // Validate doc files exist
        for (const doc of docs) {
            if (!existsSync(doc)) {
                logger.error(`File not found: ${doc}`);
                process.exit(1);
            }
        }

        try {
            // Load all documents (docs + extra context)
            const allPaths = [...docs, ...(options.context ?? [])];
            const contextDocs = loadContextDocuments(projectRoot, allPaths);

            if (contextDocs.length === 0) {
                logger.error('No documents could be loaded.');
                process.exit(1);
            }

            const formattedContext = formatContextForAgent(contextDocs);

            // Use the architect agent to break down the docs
            const config = loadConfig(projectRoot);
            const agent = createAgent('architect', config, projectRoot);
            const spinner = ora('Generating task breakdown...').start();

            const PLAN_TASK = 'Break down the following reference documents into an ordered list of implementation tasks. Output one task per line, no numbers, no bullets, no extra commentary.';

            let rawContent: string;

            if (options.stream) {
                spinner.stop();
                console.log(chalk.bold('  Generating task breakdown...\n'));
                const chunks: string[] = [];
                await agent.executeStreaming(
                    { task: PLAN_TASK, context: formattedContext },
                    { onChunk: (chunk) => { chunks.push(chunk); process.stdout.write(chunk); } },
                );
                console.log();
                rawContent = chunks.join('');
            } else {
                const output = await agent.execute({ task: PLAN_TASK, context: formattedContext });
                spinner.succeed(`Task breakdown complete (${output.tokensUsed} tokens)`);
                rawContent = output.content;
            }

            // Strip leading numbers/bullets that the LLM might include despite instructions
            const taskLines = rawContent
                .split('\n')
                .map(line => line.trim().replace(/^(\d+[\.\)]\s*|[-*]\s*)/, ''))
                .filter(line => line.length > 0);

            const formatted = options.numbered
                ? taskLines.map((line, i) => `${i + 1}. ${line}`).join('\n')
                : taskLines.join('\n');

            if (options.output) {
                writeFileSync(options.output, formatted + '\n', 'utf-8');
                logger.success(`Task list written to ${options.output}`);
                logger.info(`${taskLines.length} task(s) generated. Run with: aiagentflow run --batch ${options.output} --auto`);
            } else if (!options.stream) {
                console.log(formatted);
            }
        } catch (err) {
            logger.error(`Plan failed: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });
