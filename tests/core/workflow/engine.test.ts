/**
 * Tests for the workflow engine state machine.
 */

import { describe, it, expect } from 'vitest';
import {
    createWorkflowContext,
    transition,
    isTerminal,
    getNextAgent,
    WorkflowState,
} from '../../../src/core/workflow/engine.js';
import { WorkflowError } from '../../../src/core/errors.js';

describe('createWorkflowContext', () => {
    it('creates a context in idle state', () => {
        const ctx = createWorkflowContext('build a login page');
        expect(ctx.state).toBe('idle');
        expect(ctx.task).toBe('build a login page');
        expect(ctx.iteration).toBe(0);
        expect(ctx.history).toHaveLength(0);
    });

    it('accepts custom maxIterations', () => {
        const ctx = createWorkflowContext('task', 10);
        expect(ctx.maxIterations).toBe(10);
    });
});

describe('transition', () => {
    it('transitions from idle to spec_created', () => {
        const ctx = createWorkflowContext('task');
        const next = transition(ctx, { type: 'SPEC_READY', payload: { spec: 'the spec' } });

        expect(next.state).toBe('spec_created');
        expect(next.spec).toBe('the spec');
        expect(next.history).toHaveLength(1);
        expect(next.history[0].from).toBe('idle');
        expect(next.history[0].to).toBe('spec_created');
    });

    it('follows the happy path through all stages', () => {
        let ctx = createWorkflowContext('task');

        ctx = transition(ctx, { type: 'SPEC_READY', payload: { spec: 'spec' } });
        expect(ctx.state).toBe('spec_created');

        ctx = transition(ctx, { type: 'PLAN_APPROVED', payload: { plan: 'plan' } });
        expect(ctx.state).toBe('plan_approved');

        ctx = transition(ctx, { type: 'CODE_GENERATED', payload: { files: ['app.ts'] } });
        expect(ctx.state).toBe('code_generated');

        ctx = transition(ctx, { type: 'REVIEW_DONE', payload: { approved: true, feedback: 'LGTM' } });
        expect(ctx.state).toBe('review_done');

        ctx = transition(ctx, { type: 'TESTS_WRITTEN', payload: { testFiles: ['app.test.ts'] } });
        expect(ctx.state).toBe('tests_written');

        ctx = transition(ctx, { type: 'TESTS_PASSED' });
        expect(ctx.state).toBe('tests_passed');

        ctx = transition(ctx, { type: 'QA_APPROVED' });
        expect(ctx.state).toBe('qa_approved');

        expect(isTerminal(ctx)).toBe(false);
    });

    it('handles review rejection by sending to fixer', () => {
        let ctx = createWorkflowContext('task');
        ctx = transition(ctx, { type: 'SPEC_READY', payload: { spec: 'spec' } });
        ctx = transition(ctx, { type: 'PLAN_APPROVED', payload: { plan: 'plan' } });
        ctx = transition(ctx, { type: 'CODE_GENERATED', payload: { files: ['app.ts'] } });

        // Reviewer rejects → goes to review_rejected (fixer runs next)
        ctx = transition(ctx, { type: 'REVIEW_DONE', payload: { approved: false, feedback: 'fix imports' } });
        expect(ctx.state).toBe('review_rejected');
        expect(ctx.reviewFeedback).toBe('fix imports');
        expect(ctx.iteration).toBe(1);
    });

    it('handles test failures through fixer loop', () => {
        let ctx = createWorkflowContext('task');
        ctx = transition(ctx, { type: 'SPEC_READY', payload: { spec: 'spec' } });
        ctx = transition(ctx, { type: 'PLAN_APPROVED', payload: { plan: 'plan' } });
        ctx = transition(ctx, { type: 'CODE_GENERATED', payload: { files: ['app.ts'] } });
        ctx = transition(ctx, { type: 'REVIEW_DONE', payload: { approved: true, feedback: 'ok' } });
        ctx = transition(ctx, { type: 'TESTS_WRITTEN', payload: { testFiles: ['test.ts'] } });

        // Tests fail
        ctx = transition(ctx, { type: 'TESTS_FAILED', payload: { failures: 'TypeError in line 5' } });
        expect(ctx.state).toBe('tests_failed');
        expect(ctx.testFailures).toBe('TypeError in line 5');

        // Fixer applies fix
        ctx = transition(ctx, { type: 'FIX_APPLIED', payload: { files: ['app.ts'] } });
        expect(ctx.state).toBe('fix_applied');
        expect(ctx.iteration).toBe(1);
    });

    it('throws on invalid transition', () => {
        const ctx = createWorkflowContext('task');
        expect(() =>
            transition(ctx, { type: 'TESTS_PASSED' }),
        ).toThrow(WorkflowError);
    });

    it('throws when max iterations exceeded', () => {
        let ctx = createWorkflowContext('task', 2);
        ctx = transition(ctx, { type: 'SPEC_READY', payload: { spec: 'spec' } });
        ctx = transition(ctx, { type: 'PLAN_APPROVED', payload: { plan: 'plan' } });
        ctx = transition(ctx, { type: 'CODE_GENERATED', payload: { files: ['app.ts'] } });

        // First review rejection counts as iteration 1
        ctx = transition(ctx, { type: 'REVIEW_DONE', payload: { approved: false, feedback: 'fix it' } });
        expect(ctx.state).toBe('review_rejected');
        expect(ctx.iteration).toBe(1);

        // Fixer fixes, goes back to code_generated
        ctx = transition(ctx, { type: 'FIX_APPLIED', payload: { files: ['app.ts'] } });
        ctx = transition(ctx, { type: 'CODE_GENERATED', payload: { files: ['app.ts'] } });

        // Second review rejection should hit max iterations (iteration 2 >= maxIterations 2)
        expect(() =>
            transition(ctx, { type: 'REVIEW_DONE', payload: { approved: false, feedback: 'still bad' } }),
        ).toThrow(WorkflowError);
    });

    it('handles abort from any state', () => {
        let ctx = createWorkflowContext('task');
        ctx = transition(ctx, { type: 'SPEC_READY', payload: { spec: 'spec' } });
        ctx = transition(ctx, { type: 'ABORT', payload: { reason: 'user cancelled' } });
        expect(ctx.state).toBe('failed');
        expect(isTerminal(ctx)).toBe(true);
    });
});

describe('isTerminal', () => {
    it('returns false for non-terminal states', () => {
        const ctx = createWorkflowContext('task');
        expect(isTerminal(ctx)).toBe(false);
    });

    it('returns true for failed state', () => {
        let ctx = createWorkflowContext('task');
        ctx = transition(ctx, { type: 'ABORT' });
        expect(isTerminal(ctx)).toBe(true);
    });
});

describe('getNextAgent', () => {
    it('returns architect for idle state', () => {
        const ctx = createWorkflowContext('task');
        expect(getNextAgent(ctx)).toBe('architect');
    });

    it('returns coder for plan_approved', () => {
        let ctx = createWorkflowContext('task');
        ctx = transition(ctx, { type: 'SPEC_READY', payload: { spec: 'spec' } });
        ctx = transition(ctx, { type: 'PLAN_APPROVED', payload: { plan: 'plan' } });
        expect(getNextAgent(ctx)).toBe('coder');
    });

    it('returns fixer for tests_failed', () => {
        let ctx = createWorkflowContext('task');
        ctx = transition(ctx, { type: 'SPEC_READY', payload: { spec: 'spec' } });
        ctx = transition(ctx, { type: 'PLAN_APPROVED', payload: { plan: 'plan' } });
        ctx = transition(ctx, { type: 'CODE_GENERATED', payload: { files: ['f.ts'] } });
        ctx = transition(ctx, { type: 'REVIEW_DONE', payload: { approved: true, feedback: 'ok' } });
        ctx = transition(ctx, { type: 'TESTS_WRITTEN', payload: { testFiles: ['t.ts'] } });
        ctx = transition(ctx, { type: 'TESTS_FAILED', payload: { failures: 'err' } });
        expect(getNextAgent(ctx)).toBe('fixer');
    });

    it('returns null for terminal states', () => {
        let ctx = createWorkflowContext('task');
        ctx = transition(ctx, { type: 'ABORT' });
        expect(getNextAgent(ctx)).toBeNull();
    });
});
