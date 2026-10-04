/**
 * `aiagentflow watch`: re-run a review (or a workflow task) when files change.
 *
 * Default: review uncommitted changes (or --staged) after each burst of saves.
 * A save during a review makes it stale, so it is cancelled and re-run.
 * With --task, re-run that task's workflow instead; edits made by the run itself
 * do not trigger another run, and saves during a run are queued, not cancelled.
 *
 * Dependency direction: watch.ts → commander, watch/watcher, review command, workflow runner
 * Used by: cli/index.ts
 */

import { Command, Option } from 'commander';
import chalk from 'chalk';
import { configExists } from '../../core/config/manager.js';
import { runWorkflow } from '../../core/workflow/runner.js';
import { FAIL_ON_VALUES, type FailOn } from '../../core/review.js';
import { watchProject } from '../../watch/watcher.js';
import { reviewChanges } from './review.js';
import { ExitCode } from '../utils/exit-codes.js';
import { addBudgetOptions, budgetFromFlags, type BudgetFlags } from '../utils/run-options.js';
import { logger } from '../../utils/logger.js';

interface WatchOptions extends BudgetFlags {
    staged?: boolean;
    task?: string;
    workflow?: string;
    failOn: FailOn;
    debounce: number;
}

export const watchCommand = addBudgetOptions(new Command('watch')
    .description('Re-review your changes (or re-run a task) whenever files change')
    .option('--staged', 'Review staged changes instead of all uncommitted changes')
    .option('--task <text>', 'Re-run this task with a workflow instead of reviewing')
    .option('-w, --workflow <name>', 'Workflow for --task (default: fast)')
    .addOption(new Option('--fail-on <severity>', 'Severity shown as blocking in review reports').choices([...FAIL_ON_VALUES]).default('high'))
    .option('--debounce <ms>', 'Quiet time after the last change before running', (v: string) => parseInt(v, 10), 1500))
    .action(async (options: WatchOptions) => {
        const projectRoot = process.cwd();
        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exitCode = ExitCode.Config;
            return;
        }

        const reviewing = options.task === undefined;
        const watcher = watchProject(projectRoot, {
            debounceMs: options.debounce,
            // A review of changes that just changed again is stale; a task run edits files itself
            cancelOnChange: reviewing,
            onError: err => logger.error(err instanceof Error ? err.message : String(err)),
            run: async (changed, signal) => {
                console.log(chalk.gray(`\n── ${new Date().toLocaleTimeString()}: ${changed.length} file(s) changed (${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ', ...' : ''}) ──`));
                if (reviewing) {
                    await reviewChanges({
                        ...(options.staged ? { staged: true } : {}),
                        failOn: options.failOn,
                        output: 'text',
                        stream: false,
                        signal,
                        ...budgetFlags(options),
                    }, projectRoot);
                    return {};
                }
                const ctx = await runWorkflow({
                    projectRoot,
                    task: options.task!,
                    workflow: options.workflow ?? 'fast',
                    headless: true,
                    isolation: 'inplace',
                    streaming: false,
                    signal,
                    budget: budgetFromFlags(options),
                });
                return { changedByRun: [...ctx.generatedFiles, ...ctx.testFiles] };
            },
        });

        logger.info(`Watching ${projectRoot} (${reviewing ? `reviewing ${options.staged ? 'staged' : 'uncommitted'} changes` : `re-running "${options.task}"`}). Ctrl+C to stop.`);
        await new Promise<void>(resolve => {
            process.once('SIGINT', () => {
                void watcher.close().then(resolve);
            });
        });
    });

function budgetFlags(options: BudgetFlags): BudgetFlags {
    return {
        ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
        ...(options.maxCost ? { maxCost: options.maxCost } : {}),
        ...(options.maxTime ? { maxTime: options.maxTime } : {}),
    };
}
