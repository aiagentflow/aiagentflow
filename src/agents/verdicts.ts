/**
 * Structured verdicts for the judging roles (Reviewer, Security, Judge).
 *
 * Each judging agent ends its work by calling the `submit_verdict` tool.
 * Its input is validated with Zod; invalid input is returned to the model as
 * a tool error so it can correct itself. Agents that cannot call tools may
 * reply with the same JSON object as text instead.
 *
 * Dependency direction: verdicts.ts → zod, tools/registry (types), agents/types (types)
 * Used by: agents/roles (reviewer, security, judge), core/workflow/runner
 */

import { z } from 'zod';
import type { Tool } from '../tools/registry.js';
import type { AgentRole } from './types.js';

export const VERDICT_TOOL_NAME = 'submit_verdict';

const severitySchema = z.enum(['critical', 'high', 'medium', 'low', 'nit']);
export type Severity = z.infer<typeof severitySchema>;

const issueSchema = z.object({
    severity: severitySchema,
    message: z.string().min(1),
    file: z.string().optional(),
    line: z.number().int().positive().optional(),
    suggestion: z.string().optional(),
});
export type VerdictIssue = z.infer<typeof issueSchema>;

export const reviewVerdictSchema = z.object({
    verdict: z.enum(['approve', 'request_changes']),
    summary: z.string().min(1),
    issues: z.array(issueSchema).default([]),
});

export const securityVerdictSchema = z.object({
    verdict: z.enum(['pass', 'fail']),
    summary: z.string().min(1),
    issues: z.array(issueSchema).default([]),
});

export const judgeVerdictSchema = z.object({
    verdict: z.enum(['pass', 'fail']),
    summary: z.string().min(1),
    issues: z.array(issueSchema).default([]),
});

export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;
export type SecurityVerdict = z.infer<typeof securityVerdictSchema>;
export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;
export type Verdict = ReviewVerdict | SecurityVerdict | JudgeVerdict;

/** Roles that must return a structured verdict. */
export type VerdictRole = 'reviewer' | 'security' | 'judge';

export function isVerdictRole(role: AgentRole): role is VerdictRole {
    return role === 'reviewer' || role === 'security' || role === 'judge';
}

const SCHEMAS = {
    reviewer: reviewVerdictSchema,
    security: securityVerdictSchema,
    judge: judgeVerdictSchema,
} as const;

/** Verdict values per role, for the tool schema and prompts. */
const VERDICT_VALUES: Record<VerdictRole, readonly [string, string]> = {
    reviewer: ['approve', 'request_changes'],
    security: ['pass', 'fail'],
    judge: ['pass', 'fail'],
};

/** Whether a verdict lets the workflow move forward. */
export function isPositive(verdict: Verdict): boolean {
    return verdict.verdict === 'approve' || verdict.verdict === 'pass';
}

/**
 * Validate a candidate verdict for `role`.
 * Returns the parsed verdict, or a readable error for the model.
 */
export function parseVerdict(role: VerdictRole, input: unknown): { ok: true; verdict: Verdict } | { ok: false; error: string } {
    const result = SCHEMAS[role].safeParse(input);
    if (result.success) return { ok: true, verdict: result.data };
    const problems = result.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    return { ok: false, error: `Invalid verdict: ${problems}` };
}

/**
 * Find a verdict JSON object in free text (for models that answer in text
 * instead of calling the tool). Accepts a ```json fence or a bare object.
 */
export function extractVerdictFromText(role: VerdictRole, text: string): Verdict | undefined {
    const candidates: string[] = [];
    for (const m of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) candidates.push(m[1]!);
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

    for (const candidate of candidates) {
        try {
            const parsed = parseVerdict(role, JSON.parse(candidate));
            if (parsed.ok) return parsed.verdict;
        } catch {
            // Not JSON; try the next candidate
        }
    }
    return undefined;
}

/**
 * The submit_verdict tool for a role. `onVerdict` receives each valid verdict.
 */
export function createVerdictTool(role: VerdictRole, onVerdict: (verdict: Verdict) => void): Tool {
    const [positive, negative] = VERDICT_VALUES[role];
    return {
        definition: {
            name: VERDICT_TOOL_NAME,
            description:
                `Submit your final verdict. Call this exactly once, when your analysis is complete. ` +
                `Use "${positive}" or "${negative}".`,
            inputSchema: {
                type: 'object',
                properties: {
                    verdict: { type: 'string', enum: [positive, negative] },
                    summary: { type: 'string', description: 'One short paragraph explaining the verdict' },
                    issues: {
                        type: 'array',
                        description: 'Problems found (empty if none)',
                        items: {
                            type: 'object',
                            properties: {
                                severity: { type: 'string', enum: severitySchema.options },
                                message: { type: 'string', description: 'What is wrong and why it matters' },
                                file: { type: 'string', description: 'File path, if known' },
                                line: { type: 'integer', description: 'Line number, if known' },
                                suggestion: { type: 'string', description: 'Concrete fix' },
                            },
                            required: ['severity', 'message'],
                        },
                    },
                },
                required: ['verdict', 'summary', 'issues'],
            },
        },
        async execute(input) {
            const parsed = parseVerdict(role, input);
            if (!parsed.ok) return { content: `${parsed.error}. Fix the input and call ${VERDICT_TOOL_NAME} again.`, isError: true };
            onVerdict(parsed.verdict);
            return 'Verdict recorded.';
        },
    };
}

/** Render a verdict as markdown for prompts, approvals, and reports. */
export function formatVerdict(verdict: Verdict): string {
    const lines = [`**Verdict:** ${verdict.verdict.toUpperCase()}`, '', verdict.summary];
    if (verdict.issues.length > 0) {
        lines.push('', '**Issues:**');
        verdict.issues.forEach((issue, i) => {
            const where = issue.file ? ` ${issue.file}${issue.line ? `:${issue.line}` : ''}` : '';
            lines.push(`${i + 1}. [${issue.severity}]${where} ${issue.message}`);
            if (issue.suggestion) lines.push(`   Fix: ${issue.suggestion}`);
        });
    }
    return lines.join('\n');
}
