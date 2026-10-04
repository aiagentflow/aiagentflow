/**
 * Run events: a typed record of what happens during a workflow run.
 *
 * The executor and runner emit events on an EventBus. Subscribers turn them
 * into NDJSON on stdout (`--output json`), a per-session event log that the
 * TUI tails, or anything else (CI annotations, editors).
 *
 * Dependency direction: events.ts → node:fs, agents/verdicts (types), providers/types (types)
 * Used by: workflow runner and executor, CLI run/resume, TUI
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentRole } from '../agents/types.js';
import type { Verdict } from '../agents/verdicts.js';
import type { TokenUsage } from '../providers/types.js';
import type { RunStatus, StepRecord } from './workflow/engine.js';

/** Every event a run can emit. */
export type RunEvent =
    | { type: 'run.started'; sessionId: string; task: string; workflow: string; resumed: boolean }
    | { type: 'step.started'; step: string; agent?: AgentRole; uses?: string }
    | { type: 'tool.called'; step: string; agent: AgentRole; tool: string; input: Record<string, unknown> }
    | { type: 'tool.result'; step: string; agent: AgentRole; tool: string; isError: boolean }
    | { type: 'check.finished'; step: string; check: 'lint' | 'test'; passed: boolean }
    | { type: 'verdict'; step: string; agent: AgentRole; verdict: Verdict }
    | {
        type: 'step.finished';
        step: string;
        /** The agent the step ran, or `uses` for a plugin step. */
        agent?: AgentRole;
        uses?: string;
        outcome: StepRecord['outcome'];
        detail?: string;
        usage?: TokenUsage;
        costUsd?: number;
    }
    | {
        type: 'run.finished';
        sessionId: string;
        status: RunStatus;
        failureReason?: string;
        iterations: number;
        files: string[];
        testFiles: string[];
        totalTokens: number;
        costUsd: number;
        durationMs: number;
    };

export type RunEventType = RunEvent['type'];

/** An emitted event with its timestamp. */
export type TimedRunEvent = RunEvent & { time: string };

type Listener = (event: TimedRunEvent) => void;

export class EventBus {
    private readonly listeners = new Set<Listener>();

    /** Add a listener; returns a function that removes it. */
    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emit(event: RunEvent): void {
        const timed: TimedRunEvent = { ...event, time: new Date().toISOString() };
        for (const listener of this.listeners) {
            try {
                listener(timed);
            } catch {
                // A broken listener must never break the run
            }
        }
    }
}

/** Write each event as one JSON line through `write`. */
export function ndjsonListener(write: (line: string) => void): Listener {
    return event => write(`${JSON.stringify(event)}\n`);
}

/** Append each event to an NDJSON file (created on first write). */
export function fileListener(path: string): Listener {
    let ready = false;
    return event => {
        if (!ready) {
            mkdirSync(dirname(path), { recursive: true });
            ready = true;
        }
        appendFileSync(path, `${JSON.stringify(event)}\n`);
    };
}

/** Read the last `limit` events from an NDJSON event log, skipping malformed lines. */
export function readEventLog(path: string, limit = 50): TimedRunEvent[] {
    if (!existsSync(path)) return [];
    const events: TimedRunEvent[] = [];
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        try {
            events.push(JSON.parse(line) as TimedRunEvent);
        } catch {
            // Partially written last line, or corruption
        }
    }
    return events.slice(-limit);
}

/** One-line human description of an event, for logs and the TUI. */
export function describeEvent(event: RunEvent): string {
    switch (event.type) {
        case 'run.started':
            return `${event.resumed ? 'Resumed' : 'Started'} ${event.workflow}: ${event.task.split('\n')[0]}`;
        case 'step.started':
            return `${event.step} (${event.agent ?? event.uses}) started`;
        case 'tool.called':
            return `${event.step}: ${event.tool}${summarizeInput(event.input)}`;
        case 'tool.result':
            return `${event.step}: ${event.tool} ${event.isError ? 'failed' : 'ok'}`;
        case 'check.finished':
            return `${event.step}: ${event.check} ${event.passed ? 'passed' : 'failed'}`;
        case 'verdict':
            return `${event.step}: ${event.verdict.verdict} (${event.verdict.issues.length} issue(s))`;
        case 'step.finished':
            return `${event.step} ${event.outcome}${event.detail ? `: ${event.detail}` : ''}`;
        case 'run.finished':
            return `Run ${event.status}${event.failureReason ? `: ${event.failureReason}` : ''}`;
    }
}

function summarizeInput(input: Record<string, unknown>): string {
    const hint = input.path ?? input.command ?? input.pattern;
    return typeof hint === 'string' ? ` ${hint.length > 60 ? `${hint.slice(0, 57)}...` : hint}` : '';
}
