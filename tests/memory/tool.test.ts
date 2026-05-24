/**
 * Tests for the remember tool (validation, authorization, file writing).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import {
    handleRememberCall,
    rememberToolDefinition,
    REMEMBER_ELIGIBLE_ROLES,
    REMEMBER_TOOL_NAME,
} from '../../src/memory/tool.js';
import { loadAll } from '../../src/memory/store.js';
import type { ToolCall } from '../../src/providers/types.js';

let tmpDir: string;

beforeEach(() => {
    tmpDir = join(os.tmpdir(), `aiagentflow-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpDir, '.aiagentflow'), { recursive: true });
});

afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
});

function makeCall(input: Record<string, unknown>): ToolCall {
    return { name: REMEMBER_TOOL_NAME, input, callId: 'test-call-id' };
}

describe('rememberToolDefinition', () => {
    it('has the correct tool name', () => {
        expect(rememberToolDefinition.name).toBe(REMEMBER_TOOL_NAME);
    });

    it('requires name, type, description, body', () => {
        const required = (rememberToolDefinition.inputSchema as { required: string[] }).required;
        expect(required).toContain('name');
        expect(required).toContain('type');
        expect(required).toContain('description');
        expect(required).toContain('body');
    });
});

describe('REMEMBER_ELIGIBLE_ROLES', () => {
    it('includes architect', () => expect(REMEMBER_ELIGIBLE_ROLES.has('architect')).toBe(true));
    it('includes reviewer', () => expect(REMEMBER_ELIGIBLE_ROLES.has('reviewer')).toBe(true));
    it('includes fixer', () => expect(REMEMBER_ELIGIBLE_ROLES.has('fixer')).toBe(true));
    it('includes judge', () => expect(REMEMBER_ELIGIBLE_ROLES.has('judge')).toBe(true));
    it('includes coder (can write reference memories)', () => expect(REMEMBER_ELIGIBLE_ROLES.has('coder')).toBe(true));
    it('includes tester (can write gotcha memories)', () => expect(REMEMBER_ELIGIBLE_ROLES.has('tester')).toBe(true));
    it('does NOT include security', () => expect(REMEMBER_ELIGIBLE_ROLES.has('security')).toBe(false));
});

describe('handleRememberCall', () => {
    it('writes a memory file on valid input', () => {
        const result = handleRememberCall(
            makeCall({
                name: 'state-machine',
                type: 'architecture',
                description: 'Core pattern',
                body: 'Runner has 12 states.',
            }),
            'architect',
            tmpDir,
        );

        expect(result.isError).toBeFalsy();
        expect(result.content).toContain('state-machine');

        const all = loadAll(tmpDir);
        expect(all).toHaveLength(1);
        expect(all[0]!.type).toBe('architecture');
    });

    it('returns error for unknown memory type', () => {
        const result = handleRememberCall(
            makeCall({ name: 'x', type: 'nonsense', description: 'd', body: 'b' }),
            'architect',
            tmpDir,
        );
        expect(result.isError).toBe(true);
        expect(result.content).toContain('unknown memory type');
    });

    it('returns error when role is not authorized for that type', () => {
        // coder cannot write architecture
        const result = handleRememberCall(
            makeCall({ name: 'x', type: 'architecture', description: 'd', body: 'b' }),
            'coder',
            tmpDir,
        );
        expect(result.isError).toBe(true);
        expect(result.content).toContain('not authorized');
    });

    it('returns error when body exceeds MAX_MEMORY_BODY_CHARS', async () => {
        const { MAX_MEMORY_BODY_CHARS } = await import('../../src/memory/types.js');
        const result = handleRememberCall(
            makeCall({
                name: 'big',
                type: 'gotcha',
                description: 'd',
                body: 'x'.repeat(MAX_MEMORY_BODY_CHARS + 1),
            }),
            'fixer',
            tmpDir,
        );
        expect(result.isError).toBe(true);
        expect(result.content).toContain('body must be between');
    });

    it('returns error when description exceeds 200 chars', () => {
        const result = handleRememberCall(
            makeCall({
                name: 'long-desc',
                type: 'convention',
                description: 'x'.repeat(201),
                body: 'body',
            }),
            'reviewer',
            tmpDir,
        );
        expect(result.isError).toBe(true);
        expect(result.content).toContain('description');
    });

    it('reviewer can write convention memory', () => {
        const result = handleRememberCall(
            makeCall({ name: 'no-any', type: 'convention', description: 'Avoid any', body: 'Use unknown.' }),
            'reviewer',
            tmpDir,
        );
        expect(result.isError).toBeFalsy();
        expect(loadAll(tmpDir)[0]!.type).toBe('convention');
    });

    it('fixer can write gotcha memory', () => {
        const result = handleRememberCall(
            makeCall({ name: 'batch-stream', type: 'gotcha', description: 'Stream in batch', body: 'Disable it.' }),
            'fixer',
            tmpDir,
        );
        expect(result.isError).toBeFalsy();
    });

    it('callId is preserved in the result', () => {
        const call = makeCall({ name: 'x', type: 'decision', description: 'd', body: 'b' });
        call.callId = 'unique-xyz';
        const result = handleRememberCall(call, 'judge', tmpDir);
        expect(result.callId).toBe('unique-xyz');
    });
});
