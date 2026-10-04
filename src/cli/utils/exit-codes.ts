/**
 * Process exit codes for run and resume, stable for scripts and CI.
 *
 *   0  passed
 *   1  the workflow failed (a gate or check failed, or the run was aborted)
 *   2  configuration or usage error (no config, unknown or invalid workflow)
 *   3  budget exceeded (tokens, cost, or time)
 *   4  provider error (authentication, network, rate limits)
 *
 * Dependency direction: exit-codes.ts → core/errors, core/workflow/engine (types)
 * Used by: cli/commands/run.ts, cli/commands/resume.ts
 */

import { BudgetExceededError, ConfigError, ProviderError, ValidationError, WorkflowError } from '../../core/errors.js';
import type { WorkflowContext } from '../../core/workflow/engine.js';

export const ExitCode = {
    Success: 0,
    Failed: 1,
    Config: 2,
    Budget: 3,
    Provider: 4,
} as const;

/** Exit code for a finished run. */
export function exitCodeForRun(ctx: Pick<WorkflowContext, 'status' | 'failureKind'>): number {
    if (ctx.status !== 'failed') return ExitCode.Success;
    switch (ctx.failureKind) {
        case 'budget':
            return ExitCode.Budget;
        case 'provider':
            return ExitCode.Provider;
        default:
            return ExitCode.Failed;
    }
}

/** Exit code for a batch: budget beats provider beats other failures. */
export function exitCodeForBatch(results: ReadonlyArray<{ status: string; result?: Pick<WorkflowContext, 'status' | 'failureKind'> }>, budgetHit: boolean): number {
    if (budgetHit || results.some(r => r.result?.failureKind === 'budget')) return ExitCode.Budget;
    const failed = results.filter(r => r.status === 'failed');
    if (failed.length === 0) return ExitCode.Success;
    return failed.every(r => r.result?.failureKind === 'provider') ? ExitCode.Provider : ExitCode.Failed;
}

/** Exit code for an error thrown before or outside a run. */
export function exitCodeForError(err: unknown): number {
    if (err instanceof BudgetExceededError) return ExitCode.Budget;
    if (err instanceof ProviderError) return ExitCode.Provider;
    // Errors raised while setting up a run: bad config, unknown workflow, nothing to resume
    if (err instanceof ConfigError || err instanceof ValidationError || err instanceof WorkflowError) return ExitCode.Config;
    return ExitCode.Failed;
}
