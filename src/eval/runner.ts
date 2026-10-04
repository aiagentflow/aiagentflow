/**
 * Eval runner: run each task in a fresh copy of its repo, then grade it with
 * the hidden tests.
 *
 * Each task runs in a temporary git repository with your project's provider
 * and agent settings, headless and in place. After the workflow finishes, the
 * hidden tests are copied in and the task's `check` command decides the result,
 * whatever the workflow itself reported.
 *
 * Dependency direction: eval/runner.ts → eval/suite, core/workflow/runner, core/config, test-runner
 * Used by: cli/commands/eval.ts
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { getConfigPath, loadConfig } from '../core/config/manager.js';
import { readJsonFile } from '../utils/fs.js';
import { runWorkflow } from '../core/workflow/runner.js';
import { runTests } from '../core/workflow/test-runner.js';
import type { BudgetLimits } from '../core/workflow/budget-tracker.js';
import type { EventBus } from '../core/events.js';
import type { FailureKind, RunStatus } from '../core/workflow/engine.js';
import type { EvalTask } from './suite.js';

export interface EvalOptions {
    /** Project whose .aiagentflow/config.json supplies providers and agent models. */
    projectRoot: string;
    /** Workflow for tasks that do not name one (default: "standard"). */
    workflow?: string;
    /** Budget for each task. */
    budget?: BudgetLimits;
    events?: EventBus;
    /** Keep each task's workspace instead of deleting it (for debugging). */
    keepWorkspaces?: boolean;
}

export interface EvalResult {
    id: string;
    language: string;
    workflow: string;
    /** Hidden tests passed. */
    passed: boolean;
    /** How the workflow itself ended. */
    status: RunStatus;
    failureKind?: FailureKind;
    failureReason?: string;
    iterations: number;
    totalTokens: number;
    costUsd: number;
    durationMs: number;
    /** Last lines of the hidden test output. */
    checkOutput: string;
    /** Where the workspace is, if kept. */
    workspace?: string;
}

/** Run one eval task. Never throws: setup or run errors become a failed result. */
export async function runEvalTask(task: EvalTask, options: EvalOptions): Promise<EvalResult> {
    const workflow = task.workflow ?? options.workflow ?? 'standard';
    const started = Date.now();
    const workspace = mkdtempSync(join(tmpdir(), `aiagentflow-eval-${task.id}-`));
    const base: Omit<EvalResult, 'passed' | 'status' | 'checkOutput'> = {
        id: task.id, language: task.language, workflow, iterations: 0, totalTokens: 0, costUsd: 0, durationMs: 0,
    };

    try {
        await prepareWorkspace(task, workspace, options.projectRoot);

        const ctx = await runWorkflow({
            projectRoot: workspace,
            task: task.prompt,
            workflow,
            headless: true,
            streaming: false,
            isolation: 'inplace',
            showSummary: false,
            budget: options.budget,
            events: options.events,
        });

        // Grade with the hidden tests, regardless of what the workflow concluded
        cpSync(join(task.dir, 'hidden'), join(workspace, 'hidden'), { recursive: true });
        const check = await runTests(workspace, task.check);

        return {
            ...base,
            passed: check.passed,
            status: ctx.status,
            ...(ctx.failureKind ? { failureKind: ctx.failureKind } : {}),
            ...(ctx.failureReason ? { failureReason: ctx.failureReason } : {}),
            iterations: ctx.iteration,
            totalTokens: ctx.usage?.totalTokens ?? 0,
            costUsd: ctx.usage?.costUsd ?? 0,
            durationMs: Date.now() - started,
            checkOutput: tail(check.output),
            ...(options.keepWorkspaces ? { workspace } : {}),
        };
    } catch (err) {
        return {
            ...base,
            passed: false,
            status: 'failed',
            failureKind: 'error',
            failureReason: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - started,
            checkOutput: '',
            ...(options.keepWorkspaces ? { workspace } : {}),
        };
    } finally {
        if (!options.keepWorkspaces) rmSync(workspace, { recursive: true, force: true });
    }
}

/** Run tasks one after another. */
export async function runEval(tasks: readonly EvalTask[], options: EvalOptions, onResult?: (r: EvalResult) => void): Promise<EvalResult[]> {
    const results: EvalResult[] = [];
    for (const task of tasks) {
        const result = await runEvalTask(task, options);
        onResult?.(result);
        results.push(result);
    }
    return results;
}

/**
 * Copy the task's repo, write a config based on the project's, and commit it
 * so the workflow starts from a clean git state.
 */
async function prepareWorkspace(task: EvalTask, workspace: string, projectRoot: string): Promise<void> {
    cpSync(join(task.dir, 'repo'), workspace, { recursive: true });

    // Validate the project config (and catch v1 configs), but copy the raw file so
    // API keys supplied through environment variables are never written to disk.
    loadConfig(projectRoot);
    const raw = readJsonFile<Record<string, Record<string, unknown>>>(getConfigPath(projectRoot));
    const config = {
        ...raw,
        project: { ...raw.project, language: task.language, testFramework: task.testFramework },
        workflow: {
            ...raw.workflow,
            humanApproval: false,
            approvalGates: [],
            isolation: 'inplace',
            autoCommit: false,
            autoCreateBranch: false,
            testCommand: task.test,
            lintCommand: undefined,
            formatCommand: undefined,
        },
    };
    mkdirSync(join(workspace, '.aiagentflow'), { recursive: true });
    writeFileSync(join(workspace, '.aiagentflow', 'config.json'), JSON.stringify(config, null, 2));

    const git = (...args: string[]) => execa('git', ['-c', 'user.email=eval@aiagentflow', '-c', 'user.name=aiagentflow-eval', ...args], { cwd: workspace });
    await git('init', '-q');
    await git('add', '-A');
    await git('commit', '-q', '-m', `eval: ${task.id}`);
}

function tail(output: string, lines = 15): string {
    return output.trim().split('\n').slice(-lines).join('\n');
}
