/**
 * Budgets — token, cost, and time caps for runs and batches.
 *
 * A single run checks `budgetExceeded` after every model turn. In batch mode,
 * tasks report their usage to a shared BudgetTracker; each new task gets the
 * remaining budget, and no new tasks start once a cap is hit.
 *
 * Dependency direction: budget-tracker.ts → (none)
 * Used by: task-queue.ts, workflow executor
 */

export interface BudgetLimits {
    /** Maximum total tokens. */
    maxTokens?: number;
    /** Maximum estimated cost in USD. */
    maxCostUsd?: number;
    /** Maximum wall-clock time in milliseconds. */
    maxTimeMs?: number;
}

/** What has been spent so far. */
export interface BudgetSpend {
    tokens: number;
    costUsd: number;
    elapsedMs: number;
}

/** Returns why `spent` exceeds `limits`, or undefined if it is within budget. */
export function budgetExceeded(limits: BudgetLimits, spent: BudgetSpend): string | undefined {
    if (limits.maxTokens !== undefined && spent.tokens >= limits.maxTokens) {
        return `Token budget exceeded (${spent.tokens.toLocaleString()} of ${limits.maxTokens.toLocaleString()})`;
    }
    if (limits.maxCostUsd !== undefined && spent.costUsd >= limits.maxCostUsd) {
        return `Cost budget exceeded ($${spent.costUsd.toFixed(4)} of $${limits.maxCostUsd})`;
    }
    if (limits.maxTimeMs !== undefined && spent.elapsedMs >= limits.maxTimeMs) {
        return `Time budget exceeded (${Math.round(spent.elapsedMs / 1000)}s of ${Math.round(limits.maxTimeMs / 1000)}s)`;
    }
    return undefined;
}

/** Subtract spend from limits, for handing the remainder to the next task. */
export function remainingBudget(limits: BudgetLimits, spent: BudgetSpend): BudgetLimits {
    return {
        ...(limits.maxTokens !== undefined ? { maxTokens: Math.max(0, limits.maxTokens - spent.tokens) } : {}),
        ...(limits.maxCostUsd !== undefined ? { maxCostUsd: Math.max(0, limits.maxCostUsd - spent.costUsd) } : {}),
        ...(limits.maxTimeMs !== undefined ? { maxTimeMs: Math.max(0, limits.maxTimeMs - spent.elapsedMs) } : {}),
    };
}

export class BudgetTracker {
    private totalTokens = 0;
    private totalCostUsd = 0;
    private readonly startedAt = Date.now();
    readonly limits: BudgetLimits;

    constructor(limits: BudgetLimits = {}) {
        this.limits = limits;
    }

    /** Record usage from a completed task. */
    record(tokens: number, costUsd: number): void {
        this.totalTokens += tokens;
        this.totalCostUsd += costUsd;
    }

    /** What has been spent across all tasks so far. */
    get spent(): BudgetSpend {
        return { tokens: this.totalTokens, costUsd: this.totalCostUsd, elapsedMs: Date.now() - this.startedAt };
    }

    /** Why a budget cap has been hit, if one has. */
    get exceededReason(): string | undefined {
        return budgetExceeded(this.limits, this.spent);
    }

    /** True if a budget cap has been exceeded. */
    get exceeded(): boolean {
        return this.exceededReason !== undefined;
    }

    /** Budget left for the next task. */
    get remaining(): BudgetLimits {
        return remainingBudget(this.limits, this.spent);
    }

    get tokens(): number { return this.totalTokens; }
    get costUsd(): number { return this.totalCostUsd; }

    summary(): string {
        const parts = [`${this.totalTokens.toLocaleString()} tokens`];
        if (this.totalCostUsd > 0) {
            parts.push(`~$${this.totalCostUsd.toFixed(4)}`);
        }
        return parts.join(' / ');
    }
}
