/**
 * Tests for approval gate logic.
 */

import { describe, it, expect } from 'vitest';
import { isApprovalGated } from '../../../src/core/workflow/approval.js';

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
