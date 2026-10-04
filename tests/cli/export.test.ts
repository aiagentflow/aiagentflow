import { describe, it, expect } from 'vitest';
import { buildJsonReport, buildMarkdownReport, type SessionLike } from '../../src/cli/commands/export.js';

const session: SessionLike = {
    id: 's1',
    createdAt: 0,
    updatedAt: 65_000,
    context: {
        task: 'Add login',
        state: 'qa_approved',
        iteration: 1,
        maxIterations: 5,
        generatedFiles: ['src/login.ts'],
        testFiles: [],
        verdicts: {
            reviewer: { verdict: 'approve', summary: 'Fine', issues: [{ severity: 'nit', message: 'rename x', file: 'src/login.ts', line: 3 }] },
            judge: { verdict: 'pass', summary: 'Meets the task', issues: [] },
        },
        history: [],
    },
    tokenUsage: [],
};

describe('export reports', () => {
    it('include structured verdicts in JSON', () => {
        const json = JSON.parse(buildJsonReport(session));
        expect(json.verdicts.reviewer.issues).toEqual([{ severity: 'nit', message: 'rename x', file: 'src/login.ts', line: 3 }]);
        expect(json.verdicts.judge.verdict).toBe('pass');
    });

    it('render the QA verdict in markdown', () => {
        const md = buildMarkdownReport(session);
        expect(md).toContain('## QA Verdict');
        expect(md).toContain('**Verdict:** PASS');
    });
});
