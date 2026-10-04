import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventBus, ndjsonListener, fileListener, readEventLog, describeEvent, type TimedRunEvent } from '../../src/core/events.js';

describe('EventBus', () => {
    it('timestamps events, supports unsubscribe, and isolates failing listeners', () => {
        const bus = new EventBus();
        const seen: TimedRunEvent[] = [];
        bus.subscribe(() => { throw new Error('broken listener'); });
        const stop = bus.subscribe(e => seen.push(e));

        bus.emit({ type: 'step.started', step: 'plan', agent: 'architect' });
        stop();
        bus.emit({ type: 'step.started', step: 'implement', agent: 'coder' });

        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ type: 'step.started', step: 'plan' });
        expect(seen[0]!.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('writes one JSON object per line', () => {
        const lines: string[] = [];
        const bus = new EventBus();
        bus.subscribe(ndjsonListener(l => lines.push(l)));
        bus.emit({ type: 'check.finished', step: 'test', check: 'test', passed: false });
        expect(lines).toHaveLength(1);
        expect(lines[0]!.endsWith('\n')).toBe(true);
        expect(JSON.parse(lines[0]!)).toMatchObject({ type: 'check.finished', passed: false });
    });
});

describe('event log files', () => {
    let dir: string;
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('appends events and reads back the tail, skipping broken lines', () => {
        dir = mkdtempSync(join(tmpdir(), 'aiagentflow-events-'));
        const path = join(dir, 'nested', 'run.events.ndjson');
        const bus = new EventBus();
        bus.subscribe(fileListener(path));
        for (let i = 0; i < 5; i++) bus.emit({ type: 'step.started', step: `s${i}`, agent: 'coder' });
        appendFileSync(path, '{"type": "trunc');

        const events = readEventLog(path, 3);
        expect(events.map(e => (e as { step: string }).step)).toEqual(['s2', 's3', 's4']);
        expect(readEventLog(join(dir, 'missing.ndjson'))).toEqual([]);
    });
});

describe('describeEvent', () => {
    it('summarises tool calls with their main argument', () => {
        expect(describeEvent({ type: 'tool.called', step: 'implement', agent: 'coder', tool: 'read_file', input: { path: 'src/a.ts' } })).toBe('implement: read_file src/a.ts');
        expect(describeEvent({ type: 'run.finished', sessionId: 's', status: 'failed', failureReason: 'Max iterations', iterations: 5, files: [], testFiles: [], totalTokens: 0, costUsd: 0, durationMs: 1 })).toBe('Run failed: Max iterations');
    });
});
