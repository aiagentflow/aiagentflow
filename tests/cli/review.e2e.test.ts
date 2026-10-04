import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execaSync } from 'execa';
import { MockProvider, type MockStep } from '../helpers/mock-provider.js';
import { DEFAULT_CONFIG } from '../../src/core/config/defaults.js';
import { setLogLevel, getLogLevel, LogLevel } from '../../src/utils/logger.js';

const holder = vi.hoisted(() => ({ provider: undefined as unknown, posted: [] as unknown[] }));

vi.mock('../../src/providers/registry.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/providers/registry.js')>()),
    createProvider: () => holder.provider,
}));
vi.mock('../../src/integrations/github.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/integrations/github.js')>()),
    postPRReview: vi.fn(async (pr: number, review: unknown) => { holder.posted.push({ pr, review }); }),
}));
vi.mock('prompts', () => ({ default: vi.fn(async () => { throw new Error('review must never prompt'); }) }));

const { runReview } = await import('../../src/cli/commands/review.js');
const diffModule = await import('../../src/integrations/diff.js');

const verdict = (value: string, issues: object[] = []): MockStep => ({
    content: '',
    toolCalls: [{ name: 'submit_verdict', input: { verdict: value, summary: `Verdict ${value}`, issues } }],
});
const HIGH_ISSUE = { severity: 'high', message: 'Off-by-one in loop', file: 'src/app.ts', line: 2 };

let dir: string;
const originalLevel = getLogLevel();
const options = (over: object = {}) => ({ failOn: 'high' as const, output: 'text' as const, stream: false, ...over });

beforeEach(() => {
    setLogLevel(LogLevel.Silent);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    holder.posted = [];
    dir = mkdtempSync(join(tmpdir(), 'aiagentflow-review-'));
    mkdirSync(join(dir, '.aiagentflow'), { recursive: true });
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, '.aiagentflow', 'config.json'), JSON.stringify(DEFAULT_CONFIG));
    writeFileSync(join(dir, 'src', 'app.ts'), 'const a = 1;\n');
    const git = (...args: string[]) => execaSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir });
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    writeFileSync(join(dir, 'src', 'app.ts'), 'const a = 1;\nfor (let i = 0; i <= n; i++) {}\n');
});

afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel(originalLevel);
    rmSync(dir, { recursive: true, force: true });
});

describe('aiagentflow review', () => {
    it('reviews uncommitted changes, runs both agents, and fails on a high finding', async () => {
        const provider = new MockProvider([verdict('request_changes', [HIGH_ISSUE]), verdict('pass')]);
        holder.provider = provider;

        expect(await runReview(options(), dir)).toBe(1);

        // Both agents ran even though the reviewer requested changes
        expect(provider.calls).toHaveLength(2);
        const prompt = provider.userPrompt(0);
        expect(prompt).toContain('Diff under review (uncommitted changes)');
        expect(prompt).toContain('+for (let i = 0; i <= n; i++) {}');
        expect(prompt).toContain('## Modified Files\nsrc/app.ts');
        // Nothing was edited
        expect(provider.calls[0]!.options?.tools?.map(t => t.name)).not.toContain('edit_file');
        expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf-8')).toContain('i <= n');
    });

    it('passes when findings are below --fail-on', async () => {
        holder.provider = new MockProvider([verdict('request_changes', [HIGH_ISSUE]), verdict('pass')]);
        expect(await runReview(options({ failOn: 'critical' }), dir)).toBe(0);
    });

    it('exits 0 with nothing to review', async () => {
        holder.provider = new MockProvider([]);
        expect(await runReview(options({ staged: true }), dir)).toBe(0);
    });

    it('rejects conflicting sources and --comment without --pr', async () => {
        expect(await runReview(options({ staged: true, diff: 'a..b' }), dir)).toBe(2);
        expect(await runReview(options({ comment: true }), dir)).toBe(2);
    });

    it('posts inline comments on a PR', async () => {
        const realDiff = (await diffModule.getDiff({ kind: 'working' }, dir)).diff;
        vi.spyOn(diffModule, 'getDiff').mockResolvedValue({
            diff: realDiff, files: ['src/app.ts'], label: 'PR #7', title: 'Loop fix', description: 'Fixes the loop', headSha: 'abc123',
        });
        holder.provider = new MockProvider([
            verdict('request_changes', [HIGH_ISSUE, { severity: 'low', message: 'General note' }]),
            verdict('pass'),
        ]);

        expect(await runReview(options({ pr: 7, comment: true }), dir)).toBe(1);

        expect(holder.posted).toHaveLength(1);
        const { pr, review } = holder.posted[0] as { pr: number; review: { body: string; comments: Array<{ path: string; line: number }>; commitId: string } };
        expect(pr).toBe(7);
        expect(review.commitId).toBe('abc123');
        expect(review.comments).toEqual([expect.objectContaining({ path: 'src/app.ts', line: 2 })]);
        expect(review.body).toContain('General note');
        expect(review.body).toContain('1 finding(s) could not be placed');
    });
});
