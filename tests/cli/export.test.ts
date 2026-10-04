import { describe, it, expect } from 'vitest';
import { buildJsonReport, buildMarkdownReport, type SessionLike } from '../../src/cli/commands/export.js';

const session: SessionLike = {
    id: 's1',
    createdAt: 0,
    updatedAt: 65_000,
    context: {
        task: 'Add login',
        workflow: 'standard',
        status: 'passed',
        iteration: 1,
        maxIterations: 5,
        generatedFiles: ['src/login.ts'],
        testFiles: [],
        previousFailures: [],
        verdicts: {
            reviewer: { verdict: 'approve', summary: 'Fine', issues: [{ severity: 'nit', message: 'rename x', file: 'src/login.ts', line: 3 }] },
            judge: { verdict: 'pass', summary: 'Meets the task', issues: [] },
        },
        history: [
            { step: 'review', agent: 'reviewer', outcome: 'failed', detail: 'Changes requested', timestamp: 0 },
            { step: 'review', agent: 'reviewer', outcome: 'passed', timestamp: 1000 },
        ],
    },
    tokenUsage: [],
};

describe('export reports', () => {
    it('include structured verdicts in JSON', () => {
        const json = JSON.parse(buildJsonReport(session));
        expect(json.verdicts.reviewer.issues).toEqual([{ severity: 'nit', message: 'rename x', file: 'src/login.ts', line: 3 }]);
        expect(json.verdicts.judge.verdict).toBe('pass');
        expect(json).toMatchObject({ workflow: 'standard', status: 'passed', passed: true });
    });

    it('render the QA verdict in markdown', () => {
        const md = buildMarkdownReport(session);
        expect(md).toContain('## QA Verdict');
        expect(md).toContain('**Verdict:** PASS');
        expect(md).toContain('| 1 | `review` | 🔍 Reviewer | failed | Changes requested |');
    });
});
