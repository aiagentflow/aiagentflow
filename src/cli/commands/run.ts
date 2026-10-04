/**
 * `aiagentflow run` — Execute a workflow task or batch of tasks.
 *
 * Supports single tasks, batch mode from a file, autonomous and headless
 * modes, budgets, and GitHub PR/issue sources. Exit codes are documented in
 * cli/utils/exit-codes.ts.
 *
 * Dependency direction: run.ts → commander, workflow/runner, task-queue, config
 * Used by: cli/index.ts
 */

import { Command, Option } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { configExists } from '../../core/config/manager.js';
import { enableJsonOutput, OUTPUT_FORMATS, type OutputFormat } from '../utils/json-output.js';
import { ExitCode, exitCodeForBatch, exitCodeForError, exitCodeForRun } from '../utils/exit-codes.js';
import { runWorkflow } from '../../core/workflow/runner.js';
import { runTaskQueue, parseTasks } from '../../core/workflow/task-queue.js';
import type { BudgetLimits } from '../../core/workflow/budget-tracker.js';
import { fetchPR, fetchIssue, buildPRTask, buildIssueTask, openPR } from '../../integrations/github.js';
import { logger } from '../../utils/logger.js';

interface RunCommandOptions {
    workflow?: string;
    output: OutputFormat;
    auto?: boolean;
    headless?: boolean;
    batch?: boolean;
    mode?: string;
    stopOnFailure?: boolean;
    context?: string[];
    stream: boolean;
    dryRun?: boolean;
    isolate?: boolean;
    reviewPlan?: boolean;
    approvalGates?: string[];
    parallel?: number;
    maxTokens?: number;
    maxCost?: number;
    maxTime?: number;
    summary: boolean;
    pr?: number;
    issue?: number;
}

export const runCommand = new Command('run')
    .description('Run an AI workflow task')
    .argument('<task>', 'Task description or path to a task list file (.txt)')
    .option('-w, --workflow <name>', 'Workflow to run: standard (default), fast, review, security-audit, or a project workflow')
    .addOption(new Option('--output <format>', 'text (default) or json: NDJSON run events on stdout, human output on stderr').choices([...OUTPUT_FORMATS]).default('text'))
    .option('--auto', 'Autonomous mode — skip all human approval gates')
    .option('--headless', 'Never prompt (implies --auto); commands needing approval are denied. For CI')
    .option('--batch', 'Treat the argument as a task list file (one task per line)')
    .option('--mode <mode>', 'Deprecated: fast, balanced, or strict preset (use --workflow and config instead)')
    .option('--stop-on-failure', 'Stop the queue on first failure (batch mode)')
    .option('--context <paths...>', 'Context files to load as reference documents')
    .option('--no-stream', 'Disable real-time streaming of agent output')
    .option('--dry-run', 'Preview the workflow plan without executing agents')
    .option('--isolate', 'Run in an isolated git worktree (overrides config)')
    .option('--no-isolate', 'Run in-place without a worktree (overrides config)')
    .option('--review-plan', 'Pause for plan approval after the Architect runs')
    .option('--approval-gates <roles...>', 'Agent roles that require explicit approval (e.g. architect coder)')
    .option('--parallel <n>', 'Run batch tasks N at a time in parallel worktrees (batch mode only)', parseInt)
    .option('--max-tokens <n>', 'Stop when total tokens reach this budget (exit code 3)', parseInt)
    .option('--max-cost <usd>', 'Stop when estimated USD cost reaches this budget (exit code 3)', parseFloat)
    .option('--max-time <minutes>', 'Stop when wall-clock time reaches this budget (exit code 3)', parseFloat)
    .option('--no-summary', 'Suppress the token/cost summary at the end of the run')
    .option('--pr <number>', 'Fetch a GitHub PR and address its review comments', parseInt)
    .option('--issue <number>', 'Fetch a GitHub issue and implement it', parseInt)
    .action(async (task: string, options: RunCommandOptions) => {
        // exitCode instead of exit() after a run, so piped NDJSON output is fully flushed
        process.exitCode = await run(task, options);
    });

async function run(task: string, options: RunCommandOptions): Promise<number> {
    const projectRoot = process.cwd();

    if (!configExists(projectRoot)) {
        logger.error('No configuration found. Run "aiagentflow init" first.');
        return ExitCode.Config;
    }

    const events = options.output === 'json' ? enableJsonOutput() : undefined;

    if (options.mode) {
        logger.warn('--mode is deprecated and will be removed in v3. Use --workflow to pick the pipeline and set iterations/approval in config.');
    }

    const budget = buildBudget(options);
    // --isolate → 'worktree', --no-isolate → 'inplace', neither → config
    const isolation = options.isolate === true ? 'worktree' : options.isolate === false ? 'inplace' : undefined;

    try {
        // Batch mode: read tasks from file
        if (options.batch || task.endsWith('.txt')) {
            if (!existsSync(task)) {
                logger.error(`Task list file not found: ${task}`);
                return ExitCode.Config;
            }

            const tasks = parseTasks(readFileSync(task, 'utf-8'));
            if (tasks.length === 0) {
                logger.error('No tasks found in file. Each line should be a task description.');
                return ExitCode.Config;
            }

            const results = await runTaskQueue({
                projectRoot,
                tasks,
                workflow: options.workflow,
                events,
                auto: options.auto,
                headless: options.headless,
                mode: options.mode,
                stopOnFailure: options.stopOnFailure,
                contextPaths: options.context,
                dryRun: options.dryRun,
                parallel: options.parallel,
                isolation,
                budget,
            });

            return exitCodeForBatch(results, results.some(t => t.status === 'skipped') && budget !== undefined);
        }

        // --review-plan is shorthand for gating the architect
        const approvalGates = options.approvalGates ?? (options.reviewPlan ? ['architect'] : undefined);

        // --pr / --issue: build the task from GitHub
        let resolvedTask = task;
        if (options.pr) {
            logger.info(`Fetching PR #${options.pr}...`);
            const prContext = await fetchPR(options.pr);
            resolvedTask = buildPRTask(prContext);
            logger.info(`PR #${options.pr}: "${prContext.title}"`);
        }
        if (options.issue) {
            logger.info(`Fetching issue #${options.issue}...`);
            const issueCtx = await fetchIssue(options.issue);
            resolvedTask = buildIssueTask(issueCtx);
            logger.info(`Issue #${options.issue}: "${issueCtx.title}"`);
        }

        const result = await runWorkflow({
            projectRoot,
            task: resolvedTask,
            workflow: options.workflow,
            events,
            auto: options.auto,
            headless: options.headless,
            mode: options.mode,
            contextPaths: options.context,
            streaming: options.stream,
            dryRun: options.dryRun,
            isolation,
            approvalGates,
            budget,
            showSummary: options.summary !== false,
        });

        // Auto-open a PR for --issue runs that passed
        if (options.issue && result.status === 'passed' && isolation === 'worktree') {
            try {
                await openPR({
                    title: resolvedTask.split('\n')[0] ?? `Fix issue #${options.issue}`,
                    body: `Closes #${options.issue}\n\nGenerated by aiagentflow.`,
                    repoPath: projectRoot,
                });
            } catch (err) {
                logger.warn(`Could not open PR automatically: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        return exitCodeForRun(result);
    } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        return exitCodeForError(err);
    }
}

/** Budget from --max-tokens / --max-cost / --max-time, or undefined if none was given. */
function buildBudget(options: RunCommandOptions): BudgetLimits | undefined {
    const budget: BudgetLimits = {
        ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
        ...(options.maxCost ? { maxCostUsd: options.maxCost } : {}),
        ...(options.maxTime ? { maxTimeMs: options.maxTime * 60_000 } : {}),
    };
    return Object.keys(budget).length > 0 ? budget : undefined;
}
