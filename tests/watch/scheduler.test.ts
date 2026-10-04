import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execaSync } from 'execa';
import { WatchScheduler } from '../../src/watch/scheduler.js';
import { notIgnored, watchProject } from '../../src/watch/watcher.js';

/** A run we finish by hand, recording what it saw. */
function controllableRun() {
    const calls: Array<{ changed: readonly string[]; signal: AbortSignal; finish: (changedByRun?: string[]) => void }> = [];
    const run = (changed: readonly string[], signal: AbortSignal) =>
        new Promise<{ changedByRun?: string[] }>(resolve => {
            calls.push({ changed, signal, finish: changedByRun => resolve({ changedByRun }) });
        });
    return { calls, run };
}

describe('WatchScheduler', () => {
    afterEach(() => vi.useRealTimers());

    it('debounces a burst of changes into one run', async () => {
        vi.useFakeTimers();
        const { calls, run } = controllableRun();
        const s = new WatchScheduler({ debounceMs: 500, cancelOnChange: false, run });

        s.notify(['a.ts']);
        await vi.advanceTimersByTimeAsync(300);
        s.notify(['b.ts', 'a.ts']);
        await vi.advanceTimersByTimeAsync(499);
        expect(calls).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(calls.map(c => [...c.changed])).toEqual([['a.ts', 'b.ts']]);
    });

    it('cancels a stale run and runs again with the new changes', async () => {
        vi.useFakeTimers();
        const { calls, run } = controllableRun();
        const s = new WatchScheduler({ debounceMs: 100, cancelOnChange: true, run });

        s.notify(['a.ts']);
        await vi.advanceTimersByTimeAsync(100);
        expect(s.running).toBe(true);
        s.notify(['a.ts']);
        expect(calls[0]!.signal.aborted).toBe(true);

        calls[0]!.finish();
        await vi.advanceTimersByTimeAsync(100);
        expect(calls).toHaveLength(2);
        expect(calls[1]!.signal.aborted).toBe(false);
    });

    it('queues changes during a run without cancelling, and ignores files the run changed', async () => {
        vi.useFakeTimers();
        const { calls, run } = controllableRun();
        const s = new WatchScheduler({ debounceMs: 100, cancelOnChange: false, run });

        s.notify(['src/a.ts']);
        await vi.advanceTimersByTimeAsync(100);
        // The run's own edit, and a real user edit, arrive while it runs
        s.notify(['src/a.ts', 'README.md']);
        expect(calls[0]!.signal.aborted).toBe(false);

        calls[0]!.finish(['src/a.ts']);
        await vi.advanceTimersByTimeAsync(100);
        expect(calls.map(c => [...c.changed])).toEqual([['src/a.ts'], ['README.md']]);

        // When the run's own edits are the only changes, nothing follows
        calls[1]!.finish();
        await vi.advanceTimersByTimeAsync(0);
        s.notify(['src/b.ts']);
        await vi.advanceTimersByTimeAsync(100);
        s.notify(['src/b.ts']);
        calls[2]!.finish(['src/b.ts']);
        await vi.advanceTimersByTimeAsync(500);
        expect(calls).toHaveLength(3);
    });

    it('skips runs when the filter drops every path, and stops cleanly', async () => {
        vi.useFakeTimers();
        const { calls, run } = controllableRun();
        const s = new WatchScheduler({ debounceMs: 50, cancelOnChange: true, run, filter: async paths => paths.filter(p => !p.endsWith('.log')) });

        s.notify(['debug.log']);
        await vi.advanceTimersByTimeAsync(50);
        expect(calls).toHaveLength(0);

        s.notify(['a.ts']);
        await vi.advanceTimersByTimeAsync(50);
        const stopping = s.stop();
        expect(calls[0]!.signal.aborted).toBe(true);
        calls[0]!.finish();
        await stopping;
        s.notify(['b.ts']);
        await vi.advanceTimersByTimeAsync(500);
        expect(calls).toHaveLength(1);
    });
});

describe('watching files', () => {
    let dir: string;
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    function repo() {
        dir = mkdtempSync(join(tmpdir(), 'aiagentflow-watch-'));
        writeFileSync(join(dir, '.gitignore'), 'dist/\n*.log\n');
        execaSync('git', ['init', '-q'], { cwd: dir });
        return dir;
    }

    it('filters git-ignored paths, and keeps everything outside a git repository', async () => {
        repo();
        expect(await notIgnored(dir, ['src/a.ts', 'dist/x.js', 'debug.log'])).toEqual(['src/a.ts']);
        const plain = mkdtempSync(join(tmpdir(), 'aiagentflow-plain-'));
        expect(await notIgnored(plain, ['dist/x.js'])).toEqual(['dist/x.js']);
        rmSync(plain, { recursive: true, force: true });
    });

    it('runs when a tracked file changes and not for ignored or tool files', async () => {
        repo();
        mkdirSync(join(dir, 'src'));
        mkdirSync(join(dir, 'dist'));
        mkdirSync(join(dir, '.aiagentflow'));
        const runs: string[][] = [];
        const watcher = watchProject(dir, { debounceMs: 150, cancelOnChange: true, run: async changed => { runs.push([...changed]); return {}; } });
        try {
            await new Promise(r => setTimeout(r, 100));
            writeFileSync(join(dir, 'dist', 'bundle.js'), 'x');
            writeFileSync(join(dir, '.aiagentflow', 'state.json'), '{}');
            writeFileSync(join(dir, 'src', 'app.ts'), 'export {};\n');
            await vi.waitFor(() => expect(runs).toHaveLength(1), { timeout: 3000 });
            expect(runs[0]).toContain('src/app.ts');
            expect(runs[0]!.some(p => p.startsWith('dist/') || p.startsWith('.aiagentflow'))).toBe(false);
        } finally {
            await watcher.close();
        }
    });
});
