/**
 * Tests for the BudgetTracker.
 */

import { describe, it, expect } from 'vitest';
import { BudgetTracker } from '../../../src/core/workflow/budget-tracker.js';

describe('BudgetTracker', () => {
    it('starts with zero usage and no cap exceeded', () => {
        const tracker = new BudgetTracker({ maxTokens: 10000 });
        expect(tracker.exceeded).toBe(false);
        expect(tracker.tokens).toBe(0);
    });

    it('accumulates tokens across record() calls', () => {
        const tracker = new BudgetTracker();
        tracker.record(500, 'claude-sonnet-4');
        tracker.record(300, 'gpt-4o');
        expect(tracker.tokens).toBe(800);
    });

    it('marks exceeded when token cap is hit', () => {
        const tracker = new BudgetTracker({ maxTokens: 1000 });
        tracker.record(999, 'gpt-4o');
        expect(tracker.exceeded).toBe(false);
        tracker.record(1, 'gpt-4o');
        expect(tracker.exceeded).toBe(true);
    });

    it('marks exceeded when cost cap is hit', () => {
        const tracker = new BudgetTracker({ maxCostUsd: 0.001 });
        // gpt-4o costs ~$0.000010 per token, so 200 tokens = $0.002 → over $0.001
        tracker.record(200, 'gpt-4o');
        expect(tracker.exceeded).toBe(true);
    });

    it('does not exceed when no limits are set', () => {
        const tracker = new BudgetTracker();
        tracker.record(999999, 'gpt-4o');
        expect(tracker.exceeded).toBe(false);
    });

    it('summary includes token count', () => {
        const tracker = new BudgetTracker();
        tracker.record(1234, 'gpt-4o');
        expect(tracker.summary()).toContain('1,234 tokens');
    });
});
