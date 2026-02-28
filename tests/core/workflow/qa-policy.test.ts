/**
 * Tests for QA policy evaluation.
 */

import { describe, it, expect } from 'vitest';
import {
    evaluateReview,
    formatPolicyForAgent,
    DEFAULT_QA_POLICY,
    type QAPolicy,
} from '../../../src/core/workflow/qa-policy.js';

describe('evaluateReview', () => {
    it('passes when no issues found', () => {
        const review = 'The code looks great. LGTM.';
        const result = evaluateReview(review, DEFAULT_QA_POLICY);

        expect(result.passed).toBe(true);
        expect(result.criticalCount).toBe(0);
        expect(result.warningCount).toBe(0);
    });

    it('fails when critical issues exceed maximum', () => {
        const review = `
      1. **CRITICAL**: SQL injection vulnerability in login handler
      2. **CRITICAL**: Missing authentication on admin routes
      3. **WARNING**: Consider adding input validation
    `;
        const result = evaluateReview(review, DEFAULT_QA_POLICY);

        expect(result.passed).toBe(false);
        expect(result.criticalCount).toBe(2);
        expect(result.warningCount).toBe(1);
    });

    it('passes when warnings are within limit', () => {
        const review = `
      1. WARNING: Use const instead of let
      2. WARNING: Missing return type
    `;
        const result = evaluateReview(review, DEFAULT_QA_POLICY);

        expect(result.passed).toBe(true);
        expect(result.warningCount).toBe(2);
    });

    it('fails when warnings exceed custom limit', () => {
        const policy: QAPolicy = { ...DEFAULT_QA_POLICY, maxWarnings: 1 };
        const review = `
      WARNING: Issue 1
      WARNING: Issue 2
    `;
        const result = evaluateReview(review, policy);

        expect(result.passed).toBe(false);
        expect(result.warningCount).toBe(2);
    });

    it('counts nits but does not fail on them', () => {
        const review = `
      NIT: Rename variable for clarity
      NIT: Add blank line before return
    `;
        const result = evaluateReview(review, DEFAULT_QA_POLICY);

        expect(result.passed).toBe(true);
        expect(result.totalIssues).toBe(2);
    });

    it('ignores casual mentions of severity words', () => {
        const review = `The code looks good. There are no critical issues found.
I see no warnings or problems. The implementation handles edge cases well.
Overall this is a solid piece of work - nothing critical to report.`;
        const result = evaluateReview(review, DEFAULT_QA_POLICY);

        expect(result.passed).toBe(true);
        expect(result.criticalCount).toBe(0);
        expect(result.warningCount).toBe(0);
    });

    it('detects structured issue markers with bullets', () => {
        const review = `
      - **CRITICAL**: Missing input validation
      - WARNING: Consider using const
      * NIT: trailing whitespace
    `;
        const result = evaluateReview(review, DEFAULT_QA_POLICY);

        expect(result.passed).toBe(false);
        expect(result.criticalCount).toBe(1);
        expect(result.warningCount).toBe(1);
        expect(result.totalIssues).toBe(3);
    });

    it('detects numbered issue markers', () => {
        const review = `
      1. CRITICAL: SQL injection
      2. WARNING: Missing type annotation
    `;
        const result = evaluateReview(review, DEFAULT_QA_POLICY);

        expect(result.passed).toBe(false);
        expect(result.criticalCount).toBe(1);
        expect(result.warningCount).toBe(1);
    });
});

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
