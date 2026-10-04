/**
 * Tests for the workflow run context helpers.
 */

import { describe, it, expect } from 'vitest';
import { createWorkflowContext, isTerminal, failRun, mergeFiles, runLabel, normalizeContext } from '../../../src/core/workflow/engine.js';

describe('createWorkflowContext', () => {
    it('starts a running context at the first step', () => {
        const ctx = createWorkflowContext('Build it', 'standard', 'plan', 4);
        expect(ctx).toEqual({
            task: 'Build it', workflow: 'standard', status: 'running', step: 'plan', iteration: 0, maxIterations: 4,
            generatedFiles: [], testFiles: [], previousFailures: [], history: [],
        });
    });
});

describe('isTerminal / failRun / runLabel', () => {
    it('treats passed and failed runs as terminal', () => {
        const ctx = createWorkflowContext('t', 'standard', 'plan');
        expect(isTerminal(ctx)).toBe(false);
        expect(runLabel(ctx)).toBe('at plan');

        const failed = failRun(ctx, 'boom');
        expect(failed).toMatchObject({ status: 'failed', step: undefined, failureReason: 'boom' });
        expect(isTerminal(failed)).toBe(true);
        expect(runLabel(failed)).toBe('failed');
        expect(isTerminal({ status: 'passed' })).toBe(true);
    });
});

describe('mergeFiles', () => {
    it('appends without duplicates, keeping order', () => {
        expect(mergeFiles(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
    });
});

describe('normalizeContext', () => {
    it('leaves current contexts untouched', () => {
        const ctx = createWorkflowContext('t', 'fast', 'code');
        expect(normalizeContext(ctx)).toBe(ctx);
    });

    it.each([
        ['qa_approved', 'passed', undefined],
        ['complete', 'passed', undefined],
        ['failed', 'failed', undefined],
        ['idle', 'running', 'plan'],
        ['code_generated', 'running', 'review'],
        ['review_rejected', 'running', 'fix'],
        ['tests_passed', 'running', 'judge'],
    ])('maps v1 state %s to %s at %s', (state, status, step) => {
        const v1 = { task: 't', state, iteration: 0, maxIterations: 5, generatedFiles: [], testFiles: [], previousFailures: [], history: [] };
        expect(normalizeContext(v1 as never)).toMatchObject({ workflow: 'standard', status, step });
    });
});
