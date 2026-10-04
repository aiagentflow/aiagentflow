import { describe, it, expect } from 'vitest';
import { parseVerdict, extractVerdictFromText, formatVerdict, createVerdictTool, isPositive } from '../../src/agents/verdicts.js';

describe('parseVerdict', () => {
    it('accepts valid verdicts per role and defaults issues', () => {
        expect(parseVerdict('reviewer', { verdict: 'approve', summary: 'ok' })).toEqual({ ok: true, verdict: { verdict: 'approve', summary: 'ok', issues: [] } });
        expect(parseVerdict('security', { verdict: 'fail', summary: 'x', issues: [{ severity: 'critical', message: 'SQLi' }] }).ok).toBe(true);
    });

    it('rejects values from another role and reports the path', () => {
        const res = parseVerdict('reviewer', { verdict: 'pass', summary: 'ok', issues: [{ severity: 'huge', message: 'x' }] });
        expect(res.ok).toBe(false);
        if (!res.ok) {
            expect(res.error).toContain('verdict:');
            expect(res.error).toContain('issues.0.severity:');
        }
    });
});

describe('extractVerdictFromText', () => {
    it('finds a fenced or bare JSON verdict', () => {
        expect(extractVerdictFromText('judge', 'Done.\n```json\n{"verdict":"pass","summary":"s","issues":[]}\n```')?.verdict).toBe('pass');
        expect(extractVerdictFromText('judge', 'Result: {"verdict":"fail","summary":"s"} end')?.verdict).toBe('fail');
        expect(extractVerdictFromText('judge', 'PASS')).toBeUndefined();
    });
});

describe('createVerdictTool', () => {
    it('records valid input and rejects invalid input', async () => {
        const seen: unknown[] = [];
        const tool = createVerdictTool('security', v => seen.push(v));
        expect(await tool.execute({ verdict: 'nope', summary: 's' })).toMatchObject({ isError: true });
        expect(await tool.execute({ verdict: 'pass', summary: 's', issues: [] })).toBe('Verdict recorded.');
        expect(seen).toHaveLength(1);
        expect(tool.definition.inputSchema).toMatchObject({ properties: { verdict: { enum: ['pass', 'fail'] } } });
    });
});

describe('formatVerdict / isPositive', () => {
    it('renders issues with location and fix', () => {
        const v = { verdict: 'request_changes' as const, summary: 'Needs work', issues: [{ severity: 'high' as const, message: 'Null deref', file: 'a.ts', line: 4, suggestion: 'Guard it' }] };
        expect(formatVerdict(v)).toBe('**Verdict:** REQUEST_CHANGES\n\nNeeds work\n\n**Issues:**\n1. [high] a.ts:4 Null deref\n   Fix: Guard it');
        expect(isPositive(v)).toBe(false);
        expect(isPositive({ verdict: 'approve', summary: '', issues: [] })).toBe(true);
    });
});
