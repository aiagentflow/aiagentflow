/**
 * Tests for the memory loader (role → type filtering, formatting).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { save } from '../../src/memory/store.js';
import { loadMemoriesForRole, formatMemoriesForAgent } from '../../src/memory/loader.js';

let tmpDir: string;

beforeEach(() => {
    tmpDir = join(os.tmpdir(), `aiagentflow-loader-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpDir, '.aiagentflow'), { recursive: true });
});

afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
});

function seedMemories() {
    save(tmpDir, { name: 'state-machine', type: 'architecture', description: 'Core runner pattern', body: 'Runner uses 12 states.' });
    save(tmpDir, { name: 'no-any-casts', type: 'convention', description: 'Avoid any', body: 'Use generics or unknown instead.' });
    save(tmpDir, { name: 'zod-over-manual', type: 'decision', description: 'Zod chosen for schemas', body: 'Config types inferred from Zod.' });
    save(tmpDir, { name: 'stream-in-batch', type: 'gotcha', description: 'Disable streaming in batch', body: 'Streaming interleaves output in parallel runs.' });
    save(tmpDir, { name: 'mcp-registry', type: 'reference', description: 'MCP registry location', body: 'src/mcp/registry.ts' });
}

describe('loadMemoriesForRole', () => {
    it('architect gets architecture, decision, reference, convention memories', () => {
        seedMemories();
        const { full } = loadMemoriesForRole(tmpDir, 'architect');
        const types = new Set(full.map(e => e.type));
        expect(types.has('architecture')).toBe(true);
        expect(types.has('decision')).toBe(true);
        expect(types.has('reference')).toBe(true);
        expect(types.has('convention')).toBe(true);
        expect(types.has('gotcha')).toBe(false);
    });

    it('fixer gets gotcha, convention, architecture memories', () => {
        seedMemories();
        const { full } = loadMemoriesForRole(tmpDir, 'fixer');
        const types = new Set(full.map(e => e.type));
        expect(types.has('gotcha')).toBe(true);
        expect(types.has('convention')).toBe(true);
        expect(types.has('architecture')).toBe(true);
        expect(types.has('decision')).toBe(false);
    });

    it('judge gets decision, convention, architecture memories', () => {
        seedMemories();
        const { full } = loadMemoriesForRole(tmpDir, 'judge');
        const types = new Set(full.map(e => e.type));
        expect(types.has('decision')).toBe(true);
        expect(types.has('convention')).toBe(true);
        expect(types.has('architecture')).toBe(true);
        expect(types.has('gotcha')).toBe(false);
    });

    it('returns empty arrays when no memories exist', () => {
        const { index, full } = loadMemoriesForRole(tmpDir, 'architect');
        expect(index).toHaveLength(0);
        expect(full).toHaveLength(0);
    });

    it('index contains name, type, description for each relevant memory', () => {
        seedMemories();
        const { index } = loadMemoriesForRole(tmpDir, 'architect');
        expect(index.length).toBeGreaterThan(0);
        for (const item of index) {
            expect(item.name).toBeTruthy();
            expect(item.type).toBeTruthy();
            expect(item.description).toBeTruthy();
        }
    });
});

describe('formatMemoriesForAgent', () => {
    it('returns empty string when no memories', () => {
        const result = formatMemoriesForAgent({ index: [], full: [] });
        expect(result).toBe('');
    });

    it('includes memory type and name in output', () => {
        seedMemories();
        const memories = loadMemoriesForRole(tmpDir, 'architect');
        const output = formatMemoriesForAgent(memories);

        expect(output).toContain('## Project Memory');
        expect(output).toContain('architecture');
        expect(output).toContain('state-machine');
    });

    it('includes memory body in output', () => {
        seedMemories();
        const memories = loadMemoriesForRole(tmpDir, 'architect');
        const output = formatMemoriesForAgent(memories);

        expect(output).toContain('Runner uses 12 states.');
    });

    it('includes description as a blockquote', () => {
        seedMemories();
        const memories = loadMemoriesForRole(tmpDir, 'architect');
        const output = formatMemoriesForAgent(memories);

        expect(output).toContain('> Core runner pattern');
    });
});
