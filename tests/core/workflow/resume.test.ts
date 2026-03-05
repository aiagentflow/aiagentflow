import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TokenTracker, type TokenUsageEntry } from '../../../src/core/workflow/token-tracker.js';
import { saveSession, loadSession, listSessions } from '../../../src/core/workflow/session.js';
import { createWorkflowContext, isTerminal, transition } from '../../../src/core/workflow/engine.js';

describe('TokenTracker.restoreEntries', () => {
    it('restores saved entries into the tracker', () => {
        const tracker = new TokenTracker();

        const savedEntries: TokenUsageEntry[] = [
            { role: 'architect', model: 'gpt-4', promptTokens: 100, completionTokens: 200, totalTokens: 300, timestamp: Date.now() },
            { role: 'coder', model: 'gpt-4', promptTokens: 150, completionTokens: 250, totalTokens: 400, timestamp: Date.now() },
        ];

        tracker.restoreEntries(savedEntries);

        expect(tracker.getEntries()).toHaveLength(2);
        expect(tracker.getTotalTokens()).toBe(700);
    });

    it('appends to existing entries', () => {
        const tracker = new TokenTracker();
        tracker.record('architect', 'gpt-4', { promptTokens: 50, completionTokens: 50, totalTokens: 100 });

        const savedEntries: TokenUsageEntry[] = [
            { role: 'coder', model: 'gpt-4', promptTokens: 100, completionTokens: 200, totalTokens: 300, timestamp: Date.now() },
        ];

        tracker.restoreEntries(savedEntries);

        expect(tracker.getEntries()).toHaveLength(2);
        expect(tracker.getTotalTokens()).toBe(400);
    });

    it('creates copies of entries (no mutation)', () => {
        const tracker = new TokenTracker();
        const original: TokenUsageEntry = {
            role: 'architect', model: 'gpt-4', promptTokens: 100, completionTokens: 200, totalTokens: 300, timestamp: Date.now(),
        };

        tracker.restoreEntries([original]);
        original.totalTokens = 999;

        expect(tracker.getEntries()[0]!.totalTokens).toBe(300);
    });
});

describe('Session persistence for resume', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'aiagentflow-resume-test-'));
        mkdirSync(join(tmpDir, '.aiagentflow', 'sessions'), { recursive: true });
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('saves and loads a session', () => {
        const ctx = createWorkflowContext('test task', 5);
        const sessionId = saveSession(tmpDir, ctx, [], 'test-session');

        expect(sessionId).toBe('test-session');

        const loaded = loadSession(tmpDir, 'test-session');
        expect(loaded).not.toBeNull();
        expect(loaded!.context.task).toBe('test task');
        expect(loaded!.context.state).toBe('idle');
    });

    it('returns null for non-existent session', () => {
        const loaded = loadSession(tmpDir, 'nonexistent');
        expect(loaded).toBeNull();
    });

    it('lists sessions sorted by updatedAt', () => {
        const ctx1 = createWorkflowContext('task 1', 5);
        const ctx2 = createWorkflowContext('task 2', 5);

        // Write session files with explicit timestamps to avoid race conditions
        const sessionsDir = join(tmpDir, '.aiagentflow', 'sessions');
        writeFileSync(join(sessionsDir, 'session-1.json'), JSON.stringify({
            id: 'session-1', createdAt: 1000, updatedAt: 1000, context: ctx1, tokenUsage: [],
        }));
        writeFileSync(join(sessionsDir, 'session-2.json'), JSON.stringify({
            id: 'session-2', createdAt: 2000, updatedAt: 2000, context: ctx2, tokenUsage: [],
        }));

        const sessions = listSessions(tmpDir);
        expect(sessions).toHaveLength(2);
        expect(sessions[0]!.id).toBe('session-2'); // most recent first
    });

    it('identifies terminal vs non-terminal sessions', () => {
        const ctx = createWorkflowContext('test', 5);
        saveSession(tmpDir, ctx, [], 'active-session');

        const failedCtx = transition(ctx, { type: 'ABORT', payload: { reason: 'error' } });
        saveSession(tmpDir, failedCtx, [], 'failed-session');

        const sessions = listSessions(tmpDir);
        const resumable = sessions.filter(s => !isTerminal(s.context));
        const terminal = sessions.filter(s => isTerminal(s.context));

        expect(resumable).toHaveLength(1);
        expect(resumable[0]!.id).toBe('active-session');
        expect(terminal).toHaveLength(1);
        expect(terminal[0]!.id).toBe('failed-session');
    });

    it('preserves token usage across save/load', () => {
        const ctx = createWorkflowContext('test', 5);
        const entries: TokenUsageEntry[] = [
            { role: 'architect', model: 'gpt-4', promptTokens: 100, completionTokens: 200, totalTokens: 300, timestamp: Date.now() },
        ];

        saveSession(tmpDir, ctx, entries, 'token-session');
        const loaded = loadSession(tmpDir, 'token-session');

        expect(loaded!.tokenUsage).toHaveLength(1);
        expect(loaded!.tokenUsage[0]!.totalTokens).toBe(300);
    });
});
