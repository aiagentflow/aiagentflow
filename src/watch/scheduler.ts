/**
 * Watch scheduling: turn a stream of file changes into one run at a time.
 *
 * - Changes are debounced: a run starts after `debounceMs` without changes.
 * - Only one run is active. Changes that arrive during a run either cancel it
 *   (when `cancelOnChange`, e.g. a read-only review that is now stale) or are
 *   queued; either way a new run follows once the current one ends.
 * - Files the run itself changed are not counted as new changes.
 *
 * Kept free of file-system code so it can be tested with fake timers.
 *
 * Dependency direction: scheduler.ts → nothing
 * Used by: watch/watcher.ts
 */

export interface RunResult {
    /** Files the run changed itself; changes to them are ignored. */
    changedByRun?: readonly string[];
}

export interface SchedulerOptions {
    debounceMs: number;
    /** Abort the active run when new changes arrive. */
    cancelOnChange: boolean;
    run: (changed: readonly string[], signal: AbortSignal) => Promise<RunResult>;
    /** Drop paths that should not trigger a run (e.g. git-ignored). Default: keep all. */
    filter?: (paths: readonly string[]) => Promise<string[]>;
    onError?: (err: unknown) => void;
}

export class WatchScheduler {
    private pending = new Set<string>();
    private timer?: ReturnType<typeof setTimeout>;
    private active?: { abort: AbortController; done: Promise<void> };
    private stopped = false;

    constructor(private readonly options: SchedulerOptions) {}

    /** Record changed paths (relative to the project root). */
    notify(paths: readonly string[]): void {
        if (this.stopped || paths.length === 0) return;
        for (const path of paths) this.pending.add(path);

        if (this.active) {
            if (this.options.cancelOnChange) this.active.abort.abort();
            return; // a follow-up run is scheduled when the active one ends
        }
        this.schedule();
    }

    /** Stop watching: cancel the timer and the active run. */
    async stop(): Promise<void> {
        this.stopped = true;
        clearTimeout(this.timer);
        this.active?.abort.abort();
        await this.active?.done;
    }

    /** True while a run is in progress. */
    get running(): boolean {
        return this.active !== undefined;
    }

    private schedule(): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.flush(), this.options.debounceMs);
    }

    private async flush(): Promise<void> {
        if (this.stopped || this.active || this.pending.size === 0) return;

        const batch = [...this.pending];
        this.pending.clear();
        const changed = this.options.filter ? await this.options.filter(batch) : batch;
        if (changed.length === 0 || this.stopped) return;

        const abort = new AbortController();
        const done = (async () => {
            try {
                const result = await this.options.run(changed, abort.signal);
                for (const own of result.changedByRun ?? []) this.pending.delete(own);
            } catch (err) {
                this.options.onError?.(err);
            }
        })();
        this.active = { abort, done };
        await done;
        this.active = undefined;

        if (this.pending.size > 0 && !this.stopped) this.schedule();
    }
}
