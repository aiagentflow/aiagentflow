/**
 * `aiagentflow workflow` — list, show, and validate workflow definitions.
 *
 * Subcommands:
 *   list              Show available workflows and their steps
 *   show <name>       Print a workflow's YAML
 *   validate [files]  Validate project workflow files (or the given files)
 *
 * Dependency direction: workflow.ts → commander, core/workflow/workflow-loader
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { relative } from 'node:path';
import { getWorkflow, loadWorkflowFile, loadWorkflows, getWorkflowsDir } from '../../core/workflow/workflow-loader.js';
import type { WorkflowDefinition } from '../../core/workflow/definition.js';
import { logger } from '../../utils/logger.js';

export const workflowCommand = new Command('workflow')
    .description('List, show, and validate workflow definitions');

workflowCommand
    .command('list')
    .description('Show available workflows')
    .action(() => {
        const projectRoot = process.cwd();
        const { workflows, errors } = loadWorkflows(projectRoot);

        for (const { definition, source } of [...workflows.values()].sort((a, b) => a.definition.name.localeCompare(b.definition.name))) {
            const where = source === 'built-in' ? chalk.gray('built-in') : chalk.cyan(relative(projectRoot, source));
            console.log(`${chalk.bold(definition.name)}  ${where}`);
            if (definition.description) console.log(chalk.gray(`  ${definition.description}`));
            console.log(chalk.gray(`  ${describeSteps(definition)}`));
            console.log();
        }

        for (const err of errors) logger.error(err.message);
        if (errors.length > 0) process.exitCode = 1;
    });

workflowCommand
    .command('show <name>')
    .description("Print a workflow's YAML")
    .action((name: string) => {
        try {
            process.stdout.write(getWorkflow(process.cwd(), name).yaml);
        } catch (err) {
            logger.error(err instanceof Error ? err.message : String(err));
            process.exitCode = 1;
        }
    });

workflowCommand
    .command('validate [files...]')
    .description(`Validate workflow files (default: everything in .aiagentflow/workflows/)`)
    .action((files: string[]) => {
        const projectRoot = process.cwd();
        let failed = 0;

        if (files.length > 0) {
            for (const file of files) {
                try {
                    const { definition } = loadWorkflowFile(file);
                    logger.success(`${file}: ${definition.name} (${definition.steps.length} steps)`);
                } catch (err) {
                    logger.error(err instanceof Error ? err.message : String(err));
                    failed++;
                }
            }
        } else {
            const { workflows, errors } = loadWorkflows(projectRoot);
            const projectFiles = [...workflows.values()].filter(w => w.source !== 'built-in');
            for (const w of projectFiles) logger.success(`${relative(projectRoot, w.source)}: ${w.definition.name}`);
            for (const err of errors) logger.error(err.message);
            failed = errors.length;
            if (projectFiles.length === 0 && errors.length === 0) {
                logger.info(`No workflow files in ${relative(projectRoot, getWorkflowsDir(projectRoot))}/`);
            }
        }

        if (failed > 0) process.exitCode = 1;
    });

/** One-line flow, e.g. "plan → implement → review → ... (on fail: fix → review)". */
export function describeSteps(wf: WorkflowDefinition): string {
    const main = wf.steps.filter(s => s.trigger === 'always').map(s => s.id).join(' → ');
    const onFail = wf.steps.filter(s => s.trigger === 'on-fail').map(s => (s.next ? `${s.id} → ${s.next}` : s.id));
    return onFail.length > 0 ? `${main}  (on fail: ${onFail.join(', ')})` : main;
}
