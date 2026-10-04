/**
 * Review results: turn the judging agents' verdicts into a report, a pass/fail
 * decision, and PR review comments.
 *
 * Dependency direction: review.ts → agents/verdicts, integrations/diff, core/workflow
 * Used by: cli/commands/review.ts
 */

import type { Severity, Verdict, VerdictIssue, VerdictRole } from '../agents/verdicts.js';
import { AGENT_ROLE_LABELS } from '../agents/types.js';
import { commentableLines } from '../integrations/diff.js';
import { parseWorkflow, type WorkflowDefinition } from './workflow/definition.js';
import type { ReviewCommentInput } from '../integrations/github.js';

/** Severities from most to least serious. */
export const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'nit'];

/** --fail-on values: a severity, or "never". */
export type FailOn = Severity | 'never';
export const FAIL_ON_VALUES: readonly FailOn[] = [...SEVERITIES, 'never'];

/** An issue together with the agent that raised it. */
export interface ReviewFinding extends VerdictIssue {
    source: VerdictRole;
}

/**
 * The review run by `aiagentflow review`: reviewer and security both run and
 * neither gates the other, so the report always has both. Whether the change
 * passes is decided afterwards from the issues and --fail-on.
 */
export const REVIEW_COMMAND_WORKFLOW: WorkflowDefinition = parseWorkflow(`name: review-all
description: Reviewer and security analysis of a diff, without fixes or gates.
steps:
  - id: review
    agent: reviewer
  - id: security
    agent: security
`, 'review command workflow');

/** All issues from the verdicts, most severe first. */
export function collectFindings(verdicts: Partial<Record<VerdictRole, Verdict>> | undefined): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    for (const [source, verdict] of Object.entries(verdicts ?? {}) as Array<[VerdictRole, Verdict]>) {
        for (const issue of verdict.issues) findings.push({ ...issue, source });
    }
    return findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}

/** Findings at or above the --fail-on severity. */
export function blockingFindings(findings: readonly ReviewFinding[], failOn: FailOn): ReviewFinding[] {
    if (failOn === 'never') return [];
    const threshold = SEVERITIES.indexOf(failOn);
    return findings.filter(f => SEVERITIES.indexOf(f.severity) <= threshold);
}

/** Markdown report of the verdicts and findings. */
export function formatReviewReport(
    label: string,
    verdicts: Partial<Record<VerdictRole, Verdict>> | undefined,
    failOn: FailOn,
): string {
    const findings = collectFindings(verdicts);
    const blocking = blockingFindings(findings, failOn);
    const lines = [`## aiagentflow review: ${label}`, ''];

    for (const [role, verdict] of Object.entries(verdicts ?? {}) as Array<[VerdictRole, Verdict]>) {
        lines.push(`**${AGENT_ROLE_LABELS[role]}:** ${verdict.verdict.toUpperCase()}. ${verdict.summary}`);
    }
    lines.push('');

    if (findings.length === 0) {
        lines.push('No issues found.');
    } else {
        lines.push(`### ${findings.length} issue(s)`, '');
        for (const f of findings) lines.push(`- ${formatFinding(f)}`);
    }

    lines.push('', failOn === 'never'
        ? 'Result: informational only (--fail-on never).'
        : blocking.length > 0
            ? `Result: **blocking**, ${blocking.length} issue(s) at or above "${failOn}".`
            : `Result: passing, no issues at or above "${failOn}".`);
    return lines.join('\n');
}

/**
 * Split findings into inline PR comments (file and line inside the diff) and
 * the rest, which go into the review body.
 */
export function buildReviewComments(findings: readonly ReviewFinding[], diff: string): { comments: ReviewCommentInput[]; unplaced: ReviewFinding[] } {
    const lines = commentableLines(diff);
    const comments: ReviewCommentInput[] = [];
    const unplaced: ReviewFinding[] = [];

    for (const f of findings) {
        if (f.file && f.line && lines.get(f.file)?.has(f.line)) {
            const fix = f.suggestion ? `\n\n**Suggested fix:** ${f.suggestion}` : '';
            comments.push({ path: f.file, line: f.line, body: `**[${f.severity}]** ${f.message}${fix}\n\n<sub>${AGENT_ROLE_LABELS[f.source]} · aiagentflow</sub>` });
        } else {
            unplaced.push(f);
        }
    }
    return { comments, unplaced };
}

function formatFinding(f: ReviewFinding): string {
    const where = f.file ? ` \`${f.file}${f.line ? `:${f.line}` : ''}\`` : '';
    const fix = f.suggestion ? ` Fix: ${f.suggestion}` : '';
    return `**[${f.severity}]**${where} ${f.message}${fix} _(${f.source})_`;
}
