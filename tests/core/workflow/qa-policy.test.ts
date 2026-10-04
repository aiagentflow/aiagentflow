/**
 * Tests for QA policy evaluation.
 */

import { describe, it, expect } from 'vitest';
import {
    formatPolicyForAgent,
    DEFAULT_QA_POLICY,
    type QAPolicy,
} from '../../../src/core/workflow/qa-policy.js';

describe('formatPolicyForAgent', () => {
    it('includes all default rules', () => {
        const formatted = formatPolicyForAgent(DEFAULT_QA_POLICY);

        expect(formatted).toContain('All tests MUST pass');
        expect(formatted).toContain('Code review MUST be approved');
        expect(formatted).toContain('Zero critical issues');
    });

    it('includes custom rules when present', () => {
        const policy: QAPolicy = {
            ...DEFAULT_QA_POLICY,
            customRules: 'All functions must have JSDoc comments.',
        };
        const formatted = formatPolicyForAgent(policy);

        expect(formatted).toContain('Custom Project Rules');
        expect(formatted).toContain('All functions must have JSDoc comments');
    });

    it('shows coverage requirement when set', () => {
        const policy: QAPolicy = { ...DEFAULT_QA_POLICY, minTestCoverage: 80 };
        const formatted = formatPolicyForAgent(policy);

        expect(formatted).toContain('80%');
    });
});
