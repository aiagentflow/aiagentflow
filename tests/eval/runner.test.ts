import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MockProvider } from '../helpers/mock-provider.js';
import { DEFAULT_CONFIG } from '../../src/core/config/defaults.js';
import { setLogLevel, getLogLevel, LogLevel } from '../../src/utils/logger.js';
import { defaultSuiteDir, loadEvalSuite } from '../../src/eval/suite.js';
import { formatEvalTable, summarize, buildJsonReport } from '../../src/eval/report.js';

const holder = vi.hoisted(() => ({ provider: undefined as unknown }));
vi.mock('../../src/providers/registry.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/providers/registry.js')>()),
    createProvider: () => holder.provider,
}));
vi.mock('prompts', () => ({ default: vi.fn(async () => { throw new Error('eval must never prompt'); }) }));

const { runEval } = await import('../../src/eval/runner.js');

const suite = loadEvalSuite(defaultSuiteDir());
const task = suite.find(t => t.id === 'js-paginate-off-by-one')!;
const solution = readFileSync(join(task.dir, 'solution', 'src', 'paginate.js'), 'utf-8');

let project: string;
const originalLevel = getLogLevel();

beforeEach(() => {
    setLogLevel(LogLevel.Silent);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    project = mkdtempSync(join(tmpdir(), 'aiagentflow-evalproj-'));
    mkdirSync(join(project, '.aiagentflow'), { recursive: true });
    writeFileSync(join(project, '.aiagentflow', 'config.json'), JSON.stringify(DEFAULT_CONFIG));
});

afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel(originalLevel);
    rmSync(project, { recursive: true, force: true });
});

describe('runEval', () => {
    it('passes a task when the agents fix it, graded by the hidden tests', async () => {
        holder.provider = new MockProvider([
            { content: '', toolCalls: [{ name: 'read_file', input: { path: 'src/paginate.js' } }] },
            { content: '', toolCalls: [{ name: 'edit_file', input: { path: 'src/paginate.js', old_string: 'const start = page * pageSize;', new_string: 'const start = (page - 1) * pageSize;' } }] },
            'Fixed the off-by-one.',
            'The existing tests cover it.',
        ]);

        const [result] = await runEval([task], { projectRoot: project, workflow: 'fast' });

        expect(result).toMatchObject({ id: 'js-paginate-off-by-one', language: 'javascript', workflow: 'fast', passed: true, status: 'passed' });
        expect(result!.totalTokens).toBeGreaterThan(0);
        expect(solution).toContain('(page - 1)');
    });

    it('fails a task when the hidden tests fail, even if the agents gave up quietly', async () => {
        // The coder changes nothing; the visible test then fails and the script runs out
        holder.provider = new MockProvider(['Looks fine to me.', 'No tests needed.']);

        const [result] = await runEval([task], { projectRoot: project, workflow: 'fast' });

        expect(result!.passed).toBe(false);
        expect(result!.checkOutput).toContain('fail');
    });

    it('keeps the workspace on request and never writes env API keys to it', async () => {
        const config = structuredClone(DEFAULT_CONFIG);
        config.providers = { anthropic: {} as never, ollama: { baseUrl: 'http://localhost:11434' } };
        writeFileSync(join(project, '.aiagentflow', 'config.json'), JSON.stringify(config));
        vi.stubEnv('ANTHROPIC_API_KEY', 'sk-secret-from-env');
        holder.provider = new MockProvider(['nothing', 'nothing']);

        const [result] = await runEval([task], { projectRoot: project, workflow: 'fast', keepWorkspaces: true });

        const written = readFileSync(join(result!.workspace!, '.aiagentflow', 'config.json'), 'utf-8');
        expect(written).not.toContain('sk-secret-from-env');
        expect(JSON.parse(written).workflow).toMatchObject({ isolation: 'inplace', humanApproval: false, testCommand: task.test });
        rmSync(result!.workspace!, { recursive: true, force: true });
        vi.unstubAllEnvs();
    });
});

describe('eval suite and report', () => {
    it('rejects invalid task files', () => {
        const dir = mkdtempSync(join(tmpdir(), 'aiagentflow-badsuite-'));
        mkdirSync(join(dir, 'bad', 'repo'), { recursive: true });
        writeFileSync(join(dir, 'bad', 'task.yml'), 'id: Bad Id\nlanguage: x\n');
        expect(() => loadEvalSuite(dir)).toThrow(/task\.yml: id: Invalid/);
        rmSync(dir, { recursive: true, force: true });
    });

    it('summarises and formats results', () => {
        const results = [
            { id: 'a', language: 'python', workflow: 'standard', passed: true, status: 'passed' as const, iterations: 1, totalTokens: 1200, costUsd: 0.01, durationMs: 30_000, checkOutput: '' },
            { id: 'b', language: 'javascript', workflow: 'standard', passed: false, status: 'failed' as const, failureKind: 'budget' as const, iterations: 3, totalTokens: 800, costUsd: 0.02, durationMs: 10_000, checkOutput: '' },
        ];
        expect(summarize(results)).toMatchObject({ tasks: 2, passed: 1, passRate: 0.5, totalTokens: 2000, meanIterations: 2 });
        const table = formatEvalTable(results);
        expect(table).toContain('FAIL (budget)');
        expect(table).toContain('1/2 (50%)');
        expect(JSON.parse(buildJsonReport(results, { workflow: 'standard', models: {} })).summary.passRate).toBe(0.5);
    });
});
