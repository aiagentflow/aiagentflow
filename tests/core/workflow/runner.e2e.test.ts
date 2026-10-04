import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execaSync } from 'execa';
import { MockProvider, type MockStep } from '../../helpers/mock-provider.js';
import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import { listSessions, saveSession } from '../../../src/core/workflow/session.js';
import { createWorkflowContext } from '../../../src/core/workflow/engine.js';
import { EventBus, readEventLog, type TimedRunEvent } from '../../../src/core/events.js';
import { getEventLogPath } from '../../../src/core/workflow/session.js';
import { setLogLevel, getLogLevel, LogLevel } from '../../../src/utils/logger.js';

const holder = vi.hoisted(() => ({ provider: undefined as unknown }));

vi.mock('../../../src/providers/registry.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/providers/registry.js')>();
    return { ...actual, createProvider: () => holder.provider };
});

const { runWorkflow, resumeWorkflow } = await import('../../../src/core/workflow/runner.js');

// Passes only when src/fixed.ts exists, so tests can drive the fail -> fix -> pass loop.
const CHECK_SCRIPT = `const fs = require('fs');
if (fs.existsSync('src/fixed.ts')) { console.log('ok'); process.exit(0); }
console.log('Error: expected src/fixed.ts to exist'); process.exit(1);`;

const PLAN = '## Plan\n1. Create src/app.ts';
const CODE = 'FILE: src/app.ts\n```ts\nexport const app = 1;\n```';
const TESTS = 'FILE: tests/app.test.ts\n```ts\nimport { app } from "../src/app";\n```';
const FIX = 'FILE: src/fixed.ts\n```ts\nexport const fixed = true;\n```';

/** A turn where a judging agent submits its verdict through the tool. */
const verdict = (value: string, issues: object[] = []): MockStep => ({
    content: '',
    toolCalls: [{ name: 'submit_verdict', input: { verdict: value, summary: `Verdict: ${value}`, issues } }],
});
const APPROVE = verdict('approve');
const REJECT = verdict('request_changes', [{ severity: 'high', message: 'rename app', file: 'src/app.ts' }]);
const PASS = verdict('pass');

function setupProject(overrides: { maxIterations?: number; requireFix?: boolean } = {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'aiagentflow-e2e-'));
    mkdirSync(join(dir, '.aiagentflow'), { recursive: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'check.cjs'), CHECK_SCRIPT);
    if (!overrides.requireFix) {
        writeFileSync(join(dir, 'src', 'fixed.ts'), 'export const fixed = true;\n');
    }

    const config = structuredClone(DEFAULT_CONFIG);
    config.workflow.humanApproval = false;
    config.workflow.autoCreateBranch = false;
    config.workflow.testCommand = 'node check.cjs';
    config.workflow.maxIterations = overrides.maxIterations ?? 5;
    writeFileSync(join(dir, '.aiagentflow', 'config.json'), JSON.stringify(config));

    execaSync('git', ['init', '-q'], { cwd: dir });
    execaSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
    return dir;
}

async function run(dir: string, steps: Array<MockStep | string>) {
    const provider = new MockProvider(steps);
    holder.provider = provider;
    const ctx = await runWorkflow({
        projectRoot: dir,
        task: 'Build the app',
        auto: true,
        streaming: false,
        isolation: 'inplace',
        showSummary: false,
    });
    return { ctx, provider };
}

describe('runWorkflow end-to-end (MockProvider)', () => {
    let dir: string;
    const originalLevel = getLogLevel();

    beforeEach(() => {
        setLogLevel(LogLevel.Silent);
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        setLogLevel(originalLevel);
        vi.restoreAllMocks();
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('runs the happy path to QA approval and writes files', async () => {
        dir = setupProject();
        const { ctx, provider } = await run(dir, [PLAN, CODE, APPROVE, PASS, TESTS, PASS]);

        expect(ctx.status).toBe('passed');
        expect(provider.remaining).toBe(0);
        expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf-8')).toContain('export const app = 1');
        expect(existsSync(join(dir, 'tests', 'app.test.ts'))).toBe(true);
        expect(ctx.history.map(h => `${h.step}:${h.outcome}`)).toEqual([
            'plan:passed', 'implement:passed', 'review:passed', 'security:passed', 'test:passed', 'judge:passed',
        ]);
    });

    it('passes the plan to the coder', async () => {
        dir = setupProject();
        const { provider } = await run(dir, [PLAN, CODE, APPROVE, PASS, TESTS, PASS]);

        const coderPrompt = provider.userPrompt(1);
        expect(coderPrompt).toContain('Create src/app.ts');
    });

    it('gives agents a repo map instead of full source files', async () => {
        dir = setupProject();
        writeFileSync(join(dir, 'src', 'existing.ts'), 'export function existingHelper() { return 42; }\n');
        const { provider } = await run(dir, [PLAN, CODE, APPROVE, PASS, TESTS, PASS]);

        const coderPrompt = provider.userPrompt(1);
        expect(coderPrompt).toContain('## Repository Map');
        expect(coderPrompt).toContain('existing.ts: fn existingHelper');
        expect(coderPrompt).not.toContain('return 42');
        expect(coderPrompt).not.toContain('## Existing Source Files');
    });

    it('routes a rejected review through the fixer and back to review', async () => {
        dir = setupProject();
        const { ctx } = await run(dir, [
            PLAN, CODE, REJECT, FIX, APPROVE, PASS, TESTS, PASS,
        ]);

        expect(ctx.status).toBe('passed');
        expect(ctx.iteration).toBe(1);
        expect(ctx.history.map(h => `${h.step}:${h.outcome}`)).toContain('review:failed');
    });

    it('routes a test failure to the fixer, which makes tests pass', async () => {
        dir = setupProject({ requireFix: true });
        const { ctx, provider } = await run(dir, [
            PLAN, CODE, APPROVE, PASS, TESTS,
            FIX, APPROVE, PASS, TESTS, PASS,
        ]);

        expect(ctx.status).toBe('passed');
        expect(ctx.history.map(h => `${h.step}:${h.outcome}`)).toContain('test:failed');
        expect(existsSync(join(dir, 'src', 'fixed.ts'))).toBe(true);
        // Fixer sees the failing test output
        expect(provider.userPrompt(5)).toContain('expected src/fixed.ts to exist');
    });

    it('fails once max iterations are exceeded', async () => {
        dir = setupProject({ maxIterations: 2 });
        const { ctx } = await run(dir, [PLAN, CODE, REJECT, FIX, REJECT]);

        expect(ctx.status).toBe('failed');
    });

    it('saves a session for the run', async () => {
        dir = setupProject();
        await run(dir, [PLAN, CODE, APPROVE, PASS, TESTS, PASS]);

        const sessions = listSessions(dir);
        expect(sessions).toHaveLength(1);
        expect(sessions[0]!.context.status).toBe('passed');
        // Usage comes from the provider: 10 prompt tokens per call in the mock
        const usage = sessions[0]!.tokenUsage;
        expect(usage.map(u => u.role)).toEqual(['architect', 'coder', 'reviewer', 'security', 'tester', 'judge']);
        expect(usage.every(u => u.promptTokens === 10)).toBe(true);
    });

    describe('with tool-driven agents', () => {
        it('records files written through tools and runs the workflow test command', async () => {
            dir = setupProject({ requireFix: true });
            const { ctx, provider } = await run(dir, [
                PLAN,
                // Coder: explore, then create a file
                { content: '', toolCalls: [{ name: 'list_dir', input: { path: '.' } }] },
                { content: '', toolCalls: [{ name: 'write_file', input: { path: 'src/app.ts', content: 'export const app = 1;\n' } }] },
                'Created src/app.ts.',
                // Reviewer reads the changed file
                { content: '', toolCalls: [{ name: 'read_file', input: { path: 'src/app.ts' } }] },
                APPROVE,
                PASS,
                // Tester writes a test and runs the allowed test command (fails: src/fixed.ts missing)
                { content: '', toolCalls: [
                    { name: 'write_file', input: { path: 'tests/app.test.ts', content: 'test\n' } },
                    { name: 'run_command', input: { command: 'node check.cjs' } },
                ] },
                'Wrote tests/app.test.ts.',
                // Fixer edits via tools
                { content: '', toolCalls: [{ name: 'write_file', input: { path: 'src/fixed.ts', content: 'export const fixed = true;\n' } }] },
                'Root cause: missing module. Fix: created src/fixed.ts.',
                APPROVE, PASS,
                { content: '', toolCalls: [{ name: 'edit_file', input: { path: 'tests/app.test.ts', old_string: 'test', new_string: 'test 2' } }] },
                'Updated tests.',
                PASS,
            ]);

            expect(ctx.status).toBe('passed');
            expect(provider.remaining).toBe(0);
            expect(ctx.generatedFiles).toEqual(expect.arrayContaining(['src/app.ts', 'src/fixed.ts']));
            expect(ctx.testFiles).toEqual(expect.arrayContaining(['tests/app.test.ts']));
            expect(readFileSync(join(dir, 'tests', 'app.test.ts'), 'utf-8')).toBe('test 2\n');

            // The reviewer saw the real file contents through read_file
            const reviewerToolTurn = provider.calls[5]!.messages[2];
            expect(reviewerToolTurn).toMatchObject({ role: 'tool', results: [{ content: expect.stringContaining('export const app = 1;') }] });
            // The tester ran the workflow test command (auto-allowed) and saw it fail
            const testerToolTurn = provider.calls[8]!.messages[2];
            expect(testerToolTurn).toMatchObject({ role: 'tool', results: [{}, { content: expect.stringContaining('Exit code: 1') }] });
        });

        it('refuses commands outside the allow list in --auto runs', async () => {
            dir = setupProject();
            const { provider } = await run(dir, [
                PLAN,
                { content: '', toolCalls: [{ name: 'run_command', input: { command: 'touch pwned.txt' } }] },
                CODE, APPROVE, PASS, TESTS, PASS,
            ]);

            expect(provider.calls[2]!.messages[2]).toMatchObject({ role: 'tool', results: [{ isError: true, content: expect.stringContaining('non-interactive') }] });
            expect(existsSync(join(dir, 'pwned.txt'))).toBe(false);
        });
    });

    describe('structured verdicts', () => {
        it('stores verdicts and feeds formatted review issues to the fixer', async () => {
            dir = setupProject();
            const { ctx, provider } = await run(dir, [PLAN, CODE, REJECT, FIX, APPROVE, PASS, TESTS, PASS]);

            expect(ctx.status).toBe('passed');
            expect(ctx.verdicts?.reviewer?.verdict).toBe('approve');
            expect(ctx.verdicts?.judge?.verdict).toBe('pass');
            expect(provider.userPrompt(3)).toContain('1. [high] src/app.ts rename app');
        });

        it('does not treat verdict words in prose as a verdict', async () => {
            dir = setupProject({ maxIterations: 3 });
            // "APPROVE" in text is ignored; the tool call says request_changes
            const prose: MockStep = { content: 'I would APPROVE this, but', toolCalls: REJECT.toolCalls };
            const { ctx } = await run(dir, [PLAN, CODE, prose, FIX, APPROVE, PASS, TESTS, PASS]);
            expect(ctx.history.map(h => `${h.step}:${h.outcome}`)).toContain('review:failed');
        });

        it('reminds an agent once, then accepts a JSON verdict in text', async () => {
            dir = setupProject();
            const { ctx, provider } = await run(dir, [
                PLAN, CODE,
                'Looks good to me.',
                '```json\n{"verdict":"approve","summary":"fine","issues":[]}\n```',
                PASS, TESTS, PASS,
            ]);
            expect(ctx.status).toBe('passed');
            const reminder = provider.calls[3]!.messages.at(-1);
            expect(reminder).toMatchObject({ role: 'user', content: expect.stringContaining('submit_verdict') });
        });

        it('fails the run clearly when no valid verdict arrives', async () => {
            dir = setupProject();
            const { ctx } = await run(dir, [PLAN, CODE, 'Looks good.', 'Still looks good.']);
            expect(ctx.status).toBe('failed');
        });

        it('returns schema errors to the agent so it can correct the verdict', async () => {
            dir = setupProject();
            const bad: MockStep = { content: '', toolCalls: [{ name: 'submit_verdict', input: { verdict: 'maybe', summary: '' } }] };
            const { ctx, provider } = await run(dir, [PLAN, CODE, bad, APPROVE, PASS, TESTS, PASS]);
            expect(ctx.status).toBe('passed');
            expect(provider.calls[3]!.messages.at(-1)).toMatchObject({
                role: 'tool', results: [{ isError: true, content: expect.stringContaining('Invalid verdict') }],
            });
        });
    });

    describe('custom workflows and resume', () => {
        const QUICK = [
            'name: quick',
            'steps:',
            '  - id: code',
            '    agent: coder',
            '  - id: test',
            '    agent: tester',
            '    checks: [test]',
            '    onFail: repair',
            '  - id: repair',
            '    agent: fixer',
            '    trigger: on-fail',
            '    next: test',
            '',
        ].join('\n');

        function addQuickWorkflow() {
            mkdirSync(join(dir, '.aiagentflow', 'workflows'), { recursive: true });
            writeFileSync(join(dir, '.aiagentflow', 'workflows', 'quick.yml'), QUICK);
        }

        it('runs a project-defined workflow', async () => {
            dir = setupProject({ requireFix: true });
            addQuickWorkflow();
            holder.provider = new MockProvider([CODE, TESTS, FIX, TESTS]);
            const ctx = await runWorkflow({ projectRoot: dir, task: 'Quick task', workflow: 'quick', auto: true, streaming: false, isolation: 'inplace', showSummary: false });

            expect(ctx.status).toBe('passed');
            expect(ctx.history.map(h => `${h.step}:${h.outcome}`)).toEqual(['code:passed', 'test:failed', 'repair:passed', 'test:passed']);
        });

        it('resumes an interrupted run of a custom workflow at its saved step', async () => {
            dir = setupProject();
            addQuickWorkflow();
            const interrupted = { ...createWorkflowContext('Quick task', 'quick', 'code'), step: 'test', generatedFiles: ['src/app.ts'] };
            saveSession(dir, interrupted, [], 'interrupted');

            const provider = new MockProvider([TESTS]);
            holder.provider = provider;
            const ctx = await resumeWorkflow({ projectRoot: dir, sessionId: 'interrupted', auto: true, streaming: false });

            expect(ctx.status).toBe('passed');
            expect(provider.calls).toHaveLength(1);
            expect(ctx.history.map(h => h.step)).toEqual(['test']);
        });

        it('resumes a v1 session on the standard workflow', async () => {
            dir = setupProject();
            mkdirSync(join(dir, '.aiagentflow', 'sessions'), { recursive: true });
            writeFileSync(join(dir, '.aiagentflow', 'sessions', 'v1.json'), JSON.stringify({
                id: 'v1', createdAt: 1, updatedAt: 1, tokenUsage: [],
                context: { task: 'Old task', state: 'tests_passed', iteration: 0, maxIterations: 5, generatedFiles: [], testFiles: [], previousFailures: [], history: [] },
            }));
            const provider = new MockProvider([PASS]);
            holder.provider = provider;

            const ctx = await resumeWorkflow({ projectRoot: dir, sessionId: 'v1', auto: true, streaming: false });

            expect(ctx.status).toBe('passed');
            expect(ctx.history.map(h => h.step)).toEqual(['judge']);
        });
    });

    describe('built-in workflows', () => {
        const runNamed = async (workflow: string, steps: Array<MockStep | string>) => {
            const provider = new MockProvider(steps);
            holder.provider = provider;
            const ctx = await runWorkflow({ projectRoot: dir, task: 'Task', workflow, auto: true, streaming: false, isolation: 'inplace', showSummary: false });
            return { ctx, provider };
        };
        const trail = (ctx: { history: Array<{ step: string; outcome: string }> }) => ctx.history.map(h => `${h.step}:${h.outcome}`);

        it('fast: implements and tests without planning or review', async () => {
            dir = setupProject({ requireFix: true });
            const { ctx, provider } = await runNamed('fast', [CODE, TESTS, FIX, TESTS]);
            expect(ctx.status).toBe('passed');
            expect(trail(ctx)).toEqual(['implement:passed', 'test:failed', 'fix:passed', 'test:passed']);
            expect(provider.remaining).toBe(0);
        });

        it('review: passes on positive verdicts without touching files', async () => {
            dir = setupProject();
            const { ctx, provider } = await runNamed('review', [APPROVE, PASS]);
            expect(ctx.status).toBe('passed');
            expect(trail(ctx)).toEqual(['review:passed', 'security:passed']);
            // Judging roles never get write tools
            expect(provider.calls[0]!.options?.tools?.map(t => t.name)).not.toContain('edit_file');
        });

        it('review: fails the run on a negative verdict, without a fix loop', async () => {
            dir = setupProject();
            const { ctx } = await runNamed('review', [REJECT]);
            expect(ctx.status).toBe('failed');
            expect(ctx.failureReason).toContain('did not pass the change');
            expect(trail(ctx)).toEqual(['review:failed']);
        });

        it('security-audit: one read-only security step that gates the run', async () => {
            dir = setupProject();
            const findings = verdict('fail', [{ severity: 'critical', message: 'Hard-coded secret', file: 'src/config.ts', line: 3 }]);
            const { ctx } = await runNamed('security-audit', [findings]);
            expect(ctx.status).toBe('failed');
            expect(ctx.verdicts?.security?.issues[0]).toMatchObject({ severity: 'critical', file: 'src/config.ts' });
        });
    });

    describe('run events', () => {
        it('emits a typed event stream and logs it per session', async () => {
            dir = setupProject();
            const events = new EventBus();
            const seen: TimedRunEvent[] = [];
            events.subscribe(e => seen.push(e));
            holder.provider = new MockProvider([
                PLAN,
                { content: '', toolCalls: [{ name: 'write_file', input: { path: 'src/app.ts', content: 'export const app = 1;\n' } }] },
                'Created src/app.ts.',
                APPROVE, PASS, TESTS, PASS,
            ]);

            const ctx = await runWorkflow({ projectRoot: dir, task: 'Build', auto: true, streaming: false, isolation: 'inplace', showSummary: false, events });

            const types = seen.map(e => e.type);
            expect(types[0]).toBe('run.started');
            expect(types.at(-1)).toBe('run.finished');
            expect(seen.filter(e => e.type === 'step.started').map(e => (e as { step: string }).step))
                .toEqual(['plan', 'implement', 'review', 'security', 'test', 'judge']);
            expect(seen).toContainEqual(expect.objectContaining({ type: 'tool.called', step: 'implement', tool: 'write_file' }));
            expect(seen).toContainEqual(expect.objectContaining({ type: 'check.finished', step: 'test', check: 'test', passed: true }));
            expect(seen).toContainEqual(expect.objectContaining({ type: 'verdict', step: 'review', verdict: expect.objectContaining({ verdict: 'approve' }) }));
            expect(seen.find(e => e.type === 'step.finished' && e.step === 'plan')).toMatchObject({ outcome: 'passed', usage: { promptTokens: 10 } });
            expect(seen.at(-1)).toMatchObject({ type: 'run.finished', status: 'passed', files: ['src/app.ts'], iterations: 0 });

            // The same events are in the session's event log
            const sessionId = (seen[0] as { sessionId: string }).sessionId;
            expect(readEventLog(getEventLogPath(dir, sessionId), 100).map(e => e.type)).toEqual(types);
            expect(ctx.status).toBe('passed');
        });
    });
});
