/**
 * File watching for `aiagentflow watch`: recursive fs.watch feeding a
 * WatchScheduler, with git-ignored and tool directories filtered out.
 *
 * Dependency direction: watcher.ts → watch/scheduler, node:fs, execa
 * Used by: cli/commands/watch.ts
 */

import { watch, type FSWatcher } from 'node:fs';
import { execa } from 'execa';
import { WatchScheduler, type SchedulerOptions } from './scheduler.js';

/** Directories that never trigger a run. */
const ALWAYS_IGNORED = ['.git/', '.aiagentflow/', 'node_modules/'];

export interface Watcher {
    scheduler: WatchScheduler;
    close(): Promise<void>;
}

/** Watch `root` recursively and run through a scheduler. */
export function watchProject(root: string, options: Omit<SchedulerOptions, 'filter'>): Watcher {
    const scheduler = new WatchScheduler({ ...options, filter: paths => notIgnored(root, paths) });
    const fsWatcher: FSWatcher = watch(root, { recursive: true }, (_event, file) => {
        if (!file) return;
        const path = file.toString().split('\\').join('/');
        if (ALWAYS_IGNORED.some(dir => path === dir.slice(0, -1) || path.startsWith(dir))) return;
        scheduler.notify([path]);
    });

    return {
        scheduler,
        async close() {
            fsWatcher.close();
            await scheduler.stop();
        },
    };
}

/** Paths that git does not ignore (all paths when the project is not a git repository). */
export async function notIgnored(root: string, paths: readonly string[]): Promise<string[]> {
    const result = await execa('git', ['check-ignore', '--stdin', '-z'], { cwd: root, input: paths.join('\0'), reject: false });
    // Exit 1: nothing ignored; 128: not a git repository
    if (result.exitCode !== 0) return [...paths];
    const ignored = new Set(result.stdout.split('\0').filter(Boolean));
    return paths.filter(p => !ignored.has(p));
}
