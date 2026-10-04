import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execaSync } from 'execa';
import { MockProvider, type MockStep } from '../../helpers/mock-provider.js';
import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import { listSessions } from '../../../src/core/workflow/session.js';
import { setLogLevel, getLogLevel, LogLevel } from '../../../src/utils/logger.js';

const holder = vi.hoisted(() => ({ provider: undefined as unknown }));

vi.mock('../../../src/providers/registry.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/providers/registry.js')>();
    return { ...actual, createProvider: () => holder.provider };
});

const { runWorkflow } = await import('../../../src/core/workflow/runner.js');

// Passes only when src/fixed.ts exists, so tests can drive the fail -> fix -> pass loop.
const CHECK_SCRIPT = `const fs = require('fs');
if (fs.existsSync('src/fixed.ts')) { console.log('ok'); process.exit(0); }
console.log('Error: expected src/fixed.ts to exist'); process.exit(1);`;

const PLAN = '## Plan\n1. Create src/app.ts';
const CODE = 'FILE: src/app.ts\n```ts\nexport const app = 1;\n```';
const TESTS = 'FILE: tests/app.test.ts\n```ts\nimport { app } from "../src/app";\n```';
const FIX = 'FILE: src/fixed.ts\n```ts\nexport const fixed = true;\n```';

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
        const { ctx, provider } = await run(dir, [PLAN, CODE, 'APPROVE', 'PASS', TESTS, 'PASS']);

        expect(ctx.state).toBe('qa_approved');
        expect(provider.remaining).toBe(0);
        expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf-8')).toContain('export const app = 1');
        expect(existsSync(join(dir, 'tests', 'app.test.ts'))).toBe(true);
        expect(ctx.history.map(h => h.to)).toEqual([
            'spec_created', 'plan_approved', 'code_generated', 'review_done',
            'security_checked', 'tests_written', 'tests_passed', 'qa_approved',
        ]);
    });

    it('passes the plan to the coder', async () => {
        dir = setupProject();
        const { provider } = await run(dir, [PLAN, CODE, 'APPROVE', 'PASS', TESTS, 'PASS']);

        const coderPrompt = provider.calls[1]!.messages[0]!.content;
        expect(coderPrompt).toContain('Create src/app.ts');
    });

    it('routes a rejected review through the fixer and back to review', async () => {
        dir = setupProject();
        const { ctx } = await run(dir, [
            PLAN, CODE, 'REQUEST_CHANGES: rename app', FIX, 'APPROVE', 'PASS', TESTS, 'PASS',
        ]);

        expect(ctx.state).toBe('qa_approved');
        expect(ctx.iteration).toBe(1);
        expect(ctx.history.map(h => h.to)).toContain('review_rejected');
    });

    it('routes a test failure to the fixer, which makes tests pass', async () => {
        dir = setupProject({ requireFix: true });
        const { ctx, provider } = await run(dir, [
            PLAN, CODE, 'APPROVE', 'PASS', TESTS,
            FIX, 'APPROVE', 'PASS', TESTS, 'PASS',
        ]);

        expect(ctx.state).toBe('qa_approved');
        expect(ctx.history.map(h => h.to)).toContain('tests_failed');
        expect(existsSync(join(dir, 'src', 'fixed.ts'))).toBe(true);
        // Fixer sees the failing test output
        expect(provider.calls[5]!.messages[0]!.content).toContain('expected src/fixed.ts to exist');
    });

    it('fails once max iterations are exceeded', async () => {
        dir = setupProject({ maxIterations: 2 });
        const { ctx } = await run(dir, [PLAN, CODE, 'REJECT', FIX, 'REJECT']);

        expect(ctx.state).toBe('failed');
    });

    it('saves a session for the run', async () => {
        dir = setupProject();
        await run(dir, [PLAN, CODE, 'APPROVE', 'PASS', TESTS, 'PASS']);

        const sessions = listSessions(dir);
        expect(sessions).toHaveLength(1);
        expect(sessions[0]!.context.state).toBe('qa_approved');
    });
});
