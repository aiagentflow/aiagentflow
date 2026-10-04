/**
 * Options shared by commands that start runs (run, review).
 *
 * Dependency direction: run-options.ts → commander, core/workflow/budget-tracker (types)
 * Used by: cli/commands/run.ts, cli/commands/review.ts
 */

import type { Command } from 'commander';
import type { BudgetLimits } from '../../core/workflow/budget-tracker.js';

export interface BudgetFlags {
    maxTokens?: number;
    maxCost?: number;
    maxTime?: number;
}

/** Add --max-tokens, --max-cost, and --max-time to a command. */
export function addBudgetOptions(command: Command): Command {
    return command
        .option('--max-tokens <n>', 'Stop when total tokens reach this budget (exit code 3)', parseInt)
        .option('--max-cost <usd>', 'Stop when estimated USD cost reaches this budget (exit code 3)', parseFloat)
        .option('--max-time <minutes>', 'Stop when wall-clock time reaches this budget (exit code 3)', parseFloat);
}

/** Budget from the budget flags, or undefined if none was given. */
export function budgetFromFlags(flags: BudgetFlags): BudgetLimits | undefined {
    const budget: BudgetLimits = {
        ...(flags.maxTokens ? { maxTokens: flags.maxTokens } : {}),
        ...(flags.maxCost ? { maxCostUsd: flags.maxCost } : {}),
        ...(flags.maxTime ? { maxTimeMs: flags.maxTime * 60_000 } : {}),
    };
    return Object.keys(budget).length > 0 ? budget : undefined;
}
