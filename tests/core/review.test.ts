import { describe, it, expect } from 'vitest';
import { blockingFindings, buildReviewComments, collectFindings, formatReviewReport, REVIEW_COMMAND_WORKFLOW } from '../../src/core/review.js';
import type { Verdict } from '../../src/agents/verdicts.js';

const verdicts: { reviewer: Verdict; security: Verdict } = {
    reviewer: { verdict: 'request_changes', summary: 'Needs work', issues: [
        { severity: 'medium', message: 'Missing error handling', file: 'src/app.ts', line: 3 },
        { severity: 'nit', message: 'Rename x' },
    ] },
    security: { verdict: 'fail', summary: 'Injection risk', issues: [
        { severity: 'critical', message: 'SQL built from input', file: 'src/db.ts', line: 40, suggestion: 'Use parameters' },
    ] },
};

describe('review results', () => {
    it('collects findings most severe first, tagged with their source', () => {
        expect(collectFindings(verdicts).map(f => `${f.severity}:${f.source}`)).toEqual(['critical:security', 'medium:reviewer', 'nit:reviewer']);
        expect(collectFindings(undefined)).toEqual([]);
    });

    it('applies the --fail-on threshold', () => {
        const findings = collectFindings(verdicts);
        expect(blockingFindings(findings, 'critical')).toHaveLength(1);
        expect(blockingFindings(findings, 'medium')).toHaveLength(2);
        expect(blockingFindings(findings, 'nit')).toHaveLength(3);
        expect(blockingFindings(findings, 'never')).toEqual([]);
    });

    it('formats a report with verdicts, findings, and the result', () => {
        const report = formatReviewReport('PR #7', verdicts, 'high');
        expect(report).toContain('## aiagentflow review: PR #7');
        expect(report).toContain('REQUEST_CHANGES. Needs work');
        expect(report).toContain('**[critical]** `src/db.ts:40` SQL built from input Fix: Use parameters _(security)_');
        expect(report).toContain('Result: **blocking**, 1 issue(s) at or above "high".');
        expect(formatReviewReport('x', { reviewer: { verdict: 'approve', summary: 'Fine', issues: [] } }, 'high')).toContain('No issues found.');
    });

    it('places findings on diff lines and keeps the rest for the body', () => {
        const diff = ['--- a/src/app.ts', '+++ b/src/app.ts', '@@ -1,3 +1,4 @@', ' a', ' b', '+c', ' d'].join('\n');
        const { comments, unplaced } = buildReviewComments(collectFindings(verdicts), diff);
        expect(comments).toEqual([{ path: 'src/app.ts', line: 3, body: expect.stringContaining('**[medium]** Missing error handling') }]);
        expect(unplaced.map(f => f.message)).toEqual(['SQL built from input', 'Rename x']);
    });

    it('runs reviewer and security without gates', () => {
        expect(REVIEW_COMMAND_WORKFLOW.steps.map(s => `${s.agent}:${s.gate ?? 'none'}`)).toEqual(['reviewer:none', 'security:none']);
    });
});
