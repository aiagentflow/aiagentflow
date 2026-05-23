/**
 * Tests for approval gate logic.
 */

import { describe, it, expect } from 'vitest';
import { needsApproval, isApprovalGated } from '../../../src/core/workflow/approval.js';

describe('needsApproval', () => {
    it('returns false when humanApproval is disabled', () => {
        expect(needsApproval(false, 'code_generated')).toBe(false);
    });

    it('returns false for terminal states even when approval is on', () => {
        expect(needsApproval(true, 'complete')).toBe(false);
        expect(needsApproval(true, 'failed')).toBe(false);
        expect(needsApproval(true, 'idle')).toBe(false);
    });

    it('returns true for mid-workflow states when approval is on', () => {
        expect(needsApproval(true, 'code_generated')).toBe(true);
        expect(needsApproval(true, 'review_done')).toBe(true);
        expect(needsApproval(true, 'tests_passed')).toBe(true);
    });
});

describe('isApprovalGated', () => {
    it('returns true when role is in the gates list', () => {
        expect(isApprovalGated('architect', ['architect', 'coder'])).toBe(true);
    });

    it('returns false when role is not in the gates list', () => {
        expect(isApprovalGated('tester', ['architect', 'coder'])).toBe(false);
    });

    it('returns false for empty gates list', () => {
        expect(isApprovalGated('architect', [])).toBe(false);
    });
});
