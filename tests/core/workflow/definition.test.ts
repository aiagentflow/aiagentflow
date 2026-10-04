import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseWorkflow, nextStep, firstStep, stepById, type WorkflowDefinition } from '../../../src/core/workflow/definition.js';
import { getWorkflow, loadWorkflows } from '../../../src/core/workflow/workflow-loader.js';

const minimal = (steps: string) => `name: mini\nsteps:\n${steps}`;

describe('parseWorkflow', () => {
    it('applies defaults', () => {
        const wf = parseWorkflow(minimal('  - id: code\n    agent: coder\n'), 'test');
        expect(wf.steps[0]).toEqual({ id: 'code', agent: 'coder', trigger: 'always', checks: [], approval: false });
        expect(wf.description).toBe('');
    });

    const errorOf = (yaml: string) => {
        try {
            parseWorkflow(yaml, 'my.yml');
        } catch (err) {
            return (err as Error).message;
        }
        return '';
    };

    it('reports field errors with their paths', () => {
        const message = errorOf(minimal('  - id: Code\n    agent: wizard\n'));
        expect(message).toContain('my.yml: invalid workflow');
        expect(message).toContain('steps[0].id: must be lowercase');
        expect(message).toContain('steps[0].agent');
    });

    it('reports cross-step problems', () => {
        const message = errorOf(minimal([
            '  - id: review',
            '    agent: coder',
            '    gate: verdict',
            '  - id: review',
            '    agent: tester',
            '    checks: [test]',
            '    onFail: nowhere',
        ].join('\n')));
        expect(message).toContain('steps[0].onFail: required when the step has a gate');
        expect(message).toContain('steps[0].gate: agent "coder" does not return a verdict');
        expect(message).toContain('steps[1].id: duplicate step id "review"');
        expect(message).toContain('steps[1].onFail: unknown step "nowhere"');
    });

    it('rejects invalid YAML and workflows with only on-fail steps', () => {
        expect(() => parseWorkflow('name: [', 'x.yml')).toThrow('x.yml: invalid YAML');
        expect(() => parseWorkflow(minimal('  - id: fix\n    agent: fixer\n    trigger: on-fail\n'), 'x')).toThrow('at least one step');
    });
});

describe('routing helpers', () => {
    const wf = getWorkflow(process.cwd(), 'standard').definition;

    it('walks the main path and skips on-fail steps', () => {
        const order: string[] = [];
        for (let s: WorkflowDefinition['steps'][number] | undefined = firstStep(wf); s; s = nextStep(wf, s)) order.push(s.id);
        expect(order).toEqual(['plan', 'implement', 'review', 'security', 'test', 'judge']);
    });

    it('follows explicit next from on-fail steps', () => {
        expect(nextStep(wf, stepById(wf, 'fix')!)?.id).toBe('review');
    });
});

describe('built-in standard workflow', () => {
    const wf = getWorkflow(process.cwd(), 'standard').definition;
    const agentOf = (id: string) => stepById(wf, id)!.agent;

    it('runs the same agents in the same order as the v1 state machine', () => {
        // v1 state machine happy path: idle → plan_approved → code_generated → review_done → security_checked → tests_passed
        const v1Happy = ['architect', 'coder', 'reviewer', 'security', 'tester', 'judge'];
        const v2Happy: string[] = [];
        for (let s: WorkflowDefinition['steps'][number] | undefined = firstStep(wf); s; s = nextStep(wf, s)) v2Happy.push(s.agent);
        expect(v2Happy).toEqual(v1Happy);
    });

    it('routes failures to the fixer, which returns to review like v1', () => {
        for (const id of ['implement', 'review', 'security', 'test', 'judge']) {
            expect(agentOf(stepById(wf, id)!.onFail!)).toBe('fixer');
        }
        // v1: fix_applied -> code_generated -> reviewer
        expect(agentOf(nextStep(wf, stepById(wf, 'fix')!)!.id)).toBe('reviewer');
    });

    it('gates the judging steps on verdicts and runs the v1 checks', () => {
        expect(['review', 'security', 'judge'].map(id => stepById(wf, id)!.gate)).toEqual(['verdict', 'verdict', 'verdict']);
        expect(stepById(wf, 'implement')!.checks).toEqual(['format', 'lint']);
        expect(stepById(wf, 'test')!.checks).toEqual(['test']);
    });
});

describe('workflow loader', () => {
    let root: string;
    const dir = () => join(root, '.aiagentflow', 'workflows');

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'aiagentflow-wf-'));
        mkdirSync(dir(), { recursive: true });
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it('loads project workflows and lets them override built-ins', () => {
        writeFileSync(join(dir(), 'quick.yml'), 'name: quick\nsteps:\n  - id: code\n    agent: coder\n');
        writeFileSync(join(dir(), 'standard.yaml'), 'name: standard\ndescription: mine\nsteps:\n  - id: code\n    agent: coder\n');
        const { workflows, errors } = loadWorkflows(root);
        expect(errors).toEqual([]);
        expect(workflows.get('quick')?.source).toBe(join(dir(), 'quick.yml'));
        expect(workflows.get('standard')?.definition.description).toBe('mine');
        expect(getWorkflow(root, 'standard').definition.description).toBe('mine');
    });

    it('reports broken files without hiding the others', () => {
        writeFileSync(join(dir(), 'broken.yml'), 'name: broken\nsteps: []\n');
        writeFileSync(join(dir(), 'renamed.yml'), 'name: other\nsteps:\n  - id: code\n    agent: coder\n');
        const { workflows, errors } = loadWorkflows(root);
        expect(workflows.has('standard')).toBe(true);
        expect(errors.map(e => e.message).join('\n')).toMatch(/broken\.yml: invalid workflow[\s\S]*renamed\.yml: name "other" must match the file name "renamed"/);
    });

    it('names the available workflows when one is missing', () => {
        expect(() => getWorkflow(root, 'nope')).toThrow('Unknown workflow "nope". Available: standard');
    });
});
