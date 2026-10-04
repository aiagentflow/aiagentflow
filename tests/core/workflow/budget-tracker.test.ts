/**
 * Tests for budgets: limit checks and the batch BudgetTracker.
 */

import { describe, it, expect } from 'vitest';
import { BudgetTracker, budgetExceeded, remainingBudget } from '../../../src/core/workflow/budget-tracker.js';

describe('budgetExceeded', () => {
    const spent = { tokens: 1000, costUsd: 0.5, elapsedMs: 60_000 };

    it('reports which limit was hit', () => {
        expect(budgetExceeded({ maxTokens: 1000 }, spent)).toBe('Token budget exceeded (1,000 of 1,000)');
        expect(budgetExceeded({ maxCostUsd: 0.25 }, spent)).toBe('Cost budget exceeded ($0.5000 of $0.25)');
        expect(budgetExceeded({ maxTimeMs: 30_000 }, spent)).toBe('Time budget exceeded (60s of 30s)');
    });

    it('returns undefined within budget or without limits', () => {
        expect(budgetExceeded({ maxTokens: 2000, maxCostUsd: 1, maxTimeMs: 120_000 }, spent)).toBeUndefined();
        expect(budgetExceeded({}, spent)).toBeUndefined();
    });
});

describe('remainingBudget', () => {
    it('subtracts spend and never goes negative', () => {
        expect(remainingBudget({ maxTokens: 1500, maxCostUsd: 0.4 }, { tokens: 1000, costUsd: 0.5, elapsedMs: 0 }))
            .toEqual({ maxTokens: 500, maxCostUsd: 0 });
    });
});

describe('BudgetTracker', () => {
    it('starts with zero usage and no cap exceeded', () => {
        const tracker = new BudgetTracker({ maxTokens: 10000 });
        expect(tracker.exceeded).toBe(false);
        expect(tracker.tokens).toBe(0);
    });

    it('accumulates tokens and cost across tasks', () => {
        const tracker = new BudgetTracker();
        tracker.record(500, 0.01);
        tracker.record(300, 0.02);
        expect(tracker.tokens).toBe(800);
        expect(tracker.costUsd).toBeCloseTo(0.03);
    });

    it('marks exceeded when the token cap is hit', () => {
        const tracker = new BudgetTracker({ maxTokens: 1000 });
        tracker.record(999, 0);
        expect(tracker.exceeded).toBe(false);
        tracker.record(1, 0);
        expect(tracker.exceeded).toBe(true);
        expect(tracker.exceededReason).toContain('Token budget exceeded');
    });

    it('marks exceeded when the cost cap is hit and hands out the remainder', () => {
        const tracker = new BudgetTracker({ maxCostUsd: 1 });
        tracker.record(100, 0.75);
        expect(tracker.remaining).toEqual({ maxCostUsd: 0.25 });
        tracker.record(100, 0.25);
        expect(tracker.exceeded).toBe(true);
    });

    it('does not exceed when no limits are set', () => {
        const tracker = new BudgetTracker();
        tracker.record(999999, 100);
        expect(tracker.exceeded).toBe(false);
    });

    it('summary includes token count', () => {
        const tracker = new BudgetTracker();
        tracker.record(1234, 0);
        expect(tracker.summary()).toContain('1,234 tokens');
    });
});
