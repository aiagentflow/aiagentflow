/**
 * Budget tracker — shared token/cost cap across parallel workflow runs.
 *
 * Multiple tasks running concurrently report their usage here.
 * When a cap is hit, no new tasks start (in-flight tasks finish).
 *
 * Dependency direction: budget-tracker.ts → (none)
 * Used by: task-queue.ts
 */

export interface BudgetLimits {
    /** Maximum total tokens across all tasks. */
    maxTokens?: number;
    /** Maximum estimated cost in USD across all tasks. */
    maxCostUsd?: number;
}

/** Approximate cost per token by provider (output tokens, USD). */
const COST_PER_TOKEN: Record<string, number> = {
    'claude-sonnet-4': 0.000015,
    'claude-opus-4': 0.000075,
    'gpt-4o': 0.000010,
    'gpt-4o-mini': 0.0000006,
    default: 0.000010,
};

function estimateCost(model: string, tokens: number): number {
    const rate = Object.entries(COST_PER_TOKEN).find(([key]) =>
        model.includes(key),
    )?.[1] ?? COST_PER_TOKEN['default']!;
    return tokens * rate;
}

export class BudgetTracker {
    private totalTokens = 0;
    private totalCostUsd = 0;
    private readonly limits: BudgetLimits;

    constructor(limits: BudgetLimits = {}) {
        this.limits = limits;
    }

    /** Record usage from a completed task. */
    record(tokens: number, model: string): void {
        this.totalTokens += tokens;
        this.totalCostUsd += estimateCost(model, tokens);
    }

    /** True if a budget cap has been exceeded. */
    get exceeded(): boolean {
        if (this.limits.maxTokens !== undefined && this.totalTokens >= this.limits.maxTokens) {
            return true;
        }
        if (this.limits.maxCostUsd !== undefined && this.totalCostUsd >= this.limits.maxCostUsd) {
            return true;
        }
        return false;
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
