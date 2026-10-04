import { describe, it, expect } from 'vitest';
import { ExitCode, exitCodeForBatch, exitCodeForError, exitCodeForRun } from '../../src/cli/utils/exit-codes.js';
import { BudgetExceededError, ConfigError, ProviderError, WorkflowError } from '../../src/core/errors.js';

describe('exit codes', () => {
    it('maps run outcomes', () => {
        expect(exitCodeForRun({ status: 'passed' })).toBe(ExitCode.Success);
        expect(exitCodeForRun({ status: 'failed', failureKind: 'checks' })).toBe(ExitCode.Failed);
        expect(exitCodeForRun({ status: 'failed', failureKind: 'aborted' })).toBe(ExitCode.Failed);
        expect(exitCodeForRun({ status: 'failed', failureKind: 'budget' })).toBe(ExitCode.Budget);
        expect(exitCodeForRun({ status: 'failed', failureKind: 'provider' })).toBe(ExitCode.Provider);
    });

    it('maps errors raised outside a run', () => {
        expect(exitCodeForError(new ConfigError('bad'))).toBe(ExitCode.Config);
        expect(exitCodeForError(new WorkflowError('Unknown workflow'))).toBe(ExitCode.Config);
        expect(exitCodeForError(new ProviderError('401'))).toBe(ExitCode.Provider);
        expect(exitCodeForError(new BudgetExceededError('over'))).toBe(ExitCode.Budget);
        expect(exitCodeForError(new Error('boom'))).toBe(ExitCode.Failed);
    });

    it('maps batch outcomes with budget taking priority', () => {
        const passed = { status: 'completed', result: { status: 'passed' as const } };
        const failed = { status: 'failed', result: { status: 'failed' as const, failureKind: 'checks' as const } };
        const provider = { status: 'failed', result: { status: 'failed' as const, failureKind: 'provider' as const } };
        expect(exitCodeForBatch([passed], false)).toBe(ExitCode.Success);
        expect(exitCodeForBatch([passed, failed], false)).toBe(ExitCode.Failed);
        expect(exitCodeForBatch([provider], false)).toBe(ExitCode.Provider);
        expect(exitCodeForBatch([passed, failed], true)).toBe(ExitCode.Budget);
    });
});
