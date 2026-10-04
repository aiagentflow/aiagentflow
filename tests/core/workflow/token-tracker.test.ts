import { describe, it, expect } from 'vitest';
import { TokenTracker, costOf } from '../../../src/core/workflow/token-tracker.js';

describe('costOf', () => {
    it('prices uncached input, cache reads, cache writes, and output separately', () => {
        // claude-sonnet-4-6: $3 in, $15 out, cache read $0.30, cache write $3.75 per 1M
        const cost = costOf({ model: 'claude-sonnet-4-6', promptTokens: 1_000_000, completionTokens: 100_000, cacheReadTokens: 800_000, cacheWriteTokens: 100_000 });
        expect(cost).toBeCloseTo(0.1 * 3 + 0.8 * 0.3 + 0.1 * 3.75 + 0.1 * 15, 6);
    });

    it('falls back to the input price for cache tokens when a model lists none', () => {
        expect(costOf({ model: 'llama-3.3-70b-versatile', promptTokens: 1_000_000, completionTokens: 0, cacheReadTokens: 500_000 })).toBeCloseTo(0.59, 6);
    });

    it('uses per-model cache read prices and treats OpenRouter free models as free', () => {
        // claude-opus-5-5: $4 in, cache reads $0.20
        expect(costOf({ model: 'claude-opus-5-5', promptTokens: 1_000_000, completionTokens: 0, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.20, 6);
        expect(costOf({ model: 'qwen/qwen3.8-27b:free', promptTokens: 1_000_000, completionTokens: 1_000_000 })).toBe(0);
    });

    it('returns 0 for unknown models', () => {
        expect(costOf({ model: 'mystery', promptTokens: 1, completionTokens: 1 })).toBe(0);
    });
});

describe('TokenTracker', () => {
    it('keeps cache counters and estimates cost from them', () => {
        const t = new TokenTracker();
        t.record('coder', 'claude-sonnet-4-6', { promptTokens: 1000, completionTokens: 100, totalTokens: 1100, cacheReadTokens: 900 });
        t.record('reviewer', 'claude-sonnet-4-6', { promptTokens: 10, completionTokens: 1, totalTokens: 11 });
        expect(t.getEntries()[0]).toMatchObject({ cacheReadTokens: 900 });
        expect(t.getEntries()[1]).not.toHaveProperty('cacheReadTokens');
        expect(t.getTotalTokens()).toBe(1111);
        expect(t.estimateCost()).toBeCloseTo(costOf(t.getEntries()[0]!) + costOf(t.getEntries()[1]!), 10);
    });
});
