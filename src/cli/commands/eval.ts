/**
 * `aiagentflow eval`: measure a workflow on coding tasks with hidden tests.
 *
 * Uses the current project's providers and agent models, so the result says
 * how well *your* setup does. Each task costs real tokens.
 *
 * Dependency direction: eval.ts → commander, eval/*, config, logger
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { configExists, loadConfig } from '../../core/config/manager.js';
import { defaultSuiteDir, loadEvalSuite } from '../../eval/suite.js';
import { runEval } from '../../eval/runner.js';
import { buildJsonReport, formatEvalTable, summarize } from '../../eval/report.js';
import { ExitCode, exitCodeForError } from '../utils/exit-codes.js';
import { addBudgetOptions, budgetFromFlags, type BudgetFlags } from '../utils/run-options.js';
import { logger } from '../../utils/logger.js';

interface EvalCommandOptions extends BudgetFlags {
    workflow?: string;
    task?: string[];
    json?: boolean;
    report?: string;
    keep?: boolean;
    minPassRate?: number;
}

export const evalCommand = addBudgetOptions(new Command('eval')
    .description('Measure a workflow on coding tasks with hidden tests (uses your providers; costs tokens)')
    .argument('[suite]', 'Suite directory (default: the suite shipped with aiagentflow)')
    .option('-w, --workflow <name>', 'Workflow to evaluate (default: standard)')
    .option('--task <ids...>', 'Only run these task ids')
    .option('--json', 'Print the JSON report on stdout instead of the table')
    .option('--report <file>', 'Also write the JSON report to this file')
    .option('--keep', 'Keep each task workspace for inspection')
    .option('--min-pass-rate <ratio>', 'Exit 1 when the pass rate is below this (0 to 1), e.g. for CI', parseFloat))
    .action(async (suite: string | undefined, options: EvalCommandOptions) => {
        process.exitCode = await evaluate(suite, options);
    });

async function evaluate(suite: string | undefined, options: EvalCommandOptions): Promise<number> {
    const projectRoot = process.cwd();
    if (!configExists(projectRoot)) {
        logger.error('No configuration found. Run "aiagentflow init" first: eval uses your providers and models.');
        return ExitCode.Config;
    }

    try {
        const config = loadConfig(projectRoot);
        let tasks = loadEvalSuite(suite ?? defaultSuiteDir());
        if (options.task?.length) {
            const unknown = options.task.filter(id => !tasks.some(t => t.id === id));
            if (unknown.length > 0) {
                logger.error(`Unknown task(s): ${unknown.join(', ')}. Available: ${tasks.map(t => t.id).join(', ')}`);
                return ExitCode.Config;
            }
            tasks = tasks.filter(t => options.task!.includes(t.id));
        }

        const workflow = options.workflow ?? 'standard';
        logger.info(`Evaluating "${workflow}" on ${tasks.length} task(s). This calls your providers and costs tokens.`);

        const results = await runEval(tasks, {
            projectRoot,
            workflow: options.workflow,
            budget: budgetFromFlags(options),
            keepWorkspaces: options.keep,
        }, r => {
            const mark = r.passed ? chalk.green('PASS') : chalk.red('FAIL');
            logger.info(`${mark} ${r.id}${r.workspace ? chalk.gray(` (${r.workspace})`) : ''}`);
        });

        const models = Object.fromEntries(Object.entries(config.agents).map(([role, a]) => [role, `${a.provider}/${a.model}`]));
        const json = buildJsonReport(results, { workflow, models });
        if (options.report) writeFileSync(options.report, `${json}\n`);
        if (options.json) {
            process.stdout.write(`${json}\n`);
        } else {
            console.log(`\n${formatEvalTable(results)}\n`);
        }

        const { passRate } = summarize(results);
        return options.minPassRate !== undefined && passRate < options.minPassRate ? ExitCode.Failed : ExitCode.Success;
    } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        return exitCodeForError(err);
    }
}
