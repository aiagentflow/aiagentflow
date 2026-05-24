/**
 * Tests for the memory store (file I/O, eviction, parsing).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { save, loadAll, deleteMemory, parseMemoryFile, nameToSlug, evictStaleMemories } from '../../src/memory/store.js';

let tmpDir: string;

beforeEach(() => {
    tmpDir = join(os.tmpdir(), `aiagentflow-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    // Seed a minimal config so configExists() doesn't matter (store doesn't call it)
    mkdirSync(join(tmpDir, '.aiagentflow'), { recursive: true });
});

afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
});

describe('nameToSlug', () => {
    it('lowercases and replaces non-alphanumeric chars with dashes', () => {
        expect(nameToSlug('State Machine Pattern')).toBe('state-machine-pattern');
    });

    it('trims leading and trailing dashes', () => {
        expect(nameToSlug('--hello--')).toBe('hello');
    });

    it('truncates to 60 chars', () => {
        const long = 'a'.repeat(80);
        expect(nameToSlug(long).length).toBeLessThanOrEqual(60);
    });
});

describe('save and loadAll', () => {
    it('round-trips a memory entry', () => {
        save(tmpDir, {
            name: 'my-pattern',
            type: 'architecture',
            description: 'Describes the workflow state machine',
            body: 'The runner uses 12 states defined in runner.ts.',
        });

        const all = loadAll(tmpDir);
        expect(all).toHaveLength(1);
        expect(all[0]!.name).toBe('my-pattern');
        expect(all[0]!.type).toBe('architecture');
        expect(all[0]!.description).toBe('Describes the workflow state machine');
        expect(all[0]!.body).toContain('runner.ts');
    });

    it('updates an existing entry and preserves created timestamp', () => {
        const first = save(tmpDir, {
            name: 'evolving-memory',
            type: 'convention',
            description: 'Original',
            body: 'First version.',
        });

        const second = save(tmpDir, {
            name: 'evolving-memory',
            type: 'convention',
            description: 'Updated',
            body: 'Second version.',
        });

        expect(second.created).toBe(first.created);
        expect(second.description).toBe('Updated');
        expect(second.body).toContain('Second version');

        const all = loadAll(tmpDir);
        expect(all).toHaveLength(1);
    });

    it('returns empty array when memory dir does not exist', () => {
        const all = loadAll('/tmp/__nonexistent_aiagentflow_test__');
        expect(all).toHaveLength(0);
    });

    it('stores multiple entries independently', () => {
        save(tmpDir, { name: 'alpha', type: 'architecture', description: 'A', body: 'body A' });
        save(tmpDir, { name: 'beta', type: 'convention', description: 'B', body: 'body B' });
        save(tmpDir, { name: 'gamma', type: 'decision', description: 'C', body: 'body C' });

        const all = loadAll(tmpDir);
        expect(all).toHaveLength(3);
        expect(all.map(e => e.type).sort()).toEqual(['architecture', 'convention', 'decision']);
    });
});

describe('deleteMemory', () => {
    it('deletes an existing memory and returns true', () => {
        save(tmpDir, { name: 'to-delete', type: 'gotcha', description: 'G', body: 'oops' });
        const result = deleteMemory(tmpDir, 'to-delete');
        expect(result).toBe(true);
        expect(loadAll(tmpDir)).toHaveLength(0);
    });

    it('returns false when memory does not exist', () => {
        const result = deleteMemory(tmpDir, 'ghost-memory');
        expect(result).toBe(false);
    });
});

describe('parseMemoryFile', () => {
    it('returns null for files without frontmatter', async () => {
        const { writeFileSync } = await import('node:fs');
        const filePath = join(tmpDir, '.aiagentflow', 'memory', 'bad.md');
        mkdirSync(join(tmpDir, '.aiagentflow', 'memory'), { recursive: true });
        writeFileSync(filePath, 'No frontmatter here.');
        expect(parseMemoryFile(filePath)).toBeNull();
    });

    it('returns null for missing type field', async () => {
        const { writeFileSync } = await import('node:fs');
        const dir = join(tmpDir, '.aiagentflow', 'memory');
        mkdirSync(dir, { recursive: true });
        const filePath = join(dir, 'partial.md');
        writeFileSync(filePath, '---\nname: partial\ndescription: x\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\nbody');
        expect(parseMemoryFile(filePath)).toBeNull();
    });
});

describe('evictStaleMemories', () => {
    it('removes memories older than MEMORY_GC_STALE_DAYS', async () => {
        const entry = save(tmpDir, { name: 'old-memory', type: 'reference', description: 'Old', body: 'stale' });

        // Backdate the updated timestamp
        const { readFileSync, writeFileSync } = await import('node:fs');
        const content = readFileSync(entry.filePath, 'utf-8');
        const old = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
        const patched = content.replace(/updated: .+/, `updated: ${old}`);
        writeFileSync(entry.filePath, patched);

        const count = evictStaleMemories(tmpDir);
        expect(count).toBe(1);
        expect(loadAll(tmpDir)).toHaveLength(0);
    });

    it('keeps fresh memories', () => {
        save(tmpDir, { name: 'fresh', type: 'convention', description: 'New', body: 'recent' });
        const count = evictStaleMemories(tmpDir);
        expect(count).toBe(0);
        expect(loadAll(tmpDir)).toHaveLength(1);
    });

    it('returns 0 when memory dir is empty', () => {
        const count = evictStaleMemories(tmpDir);
        expect(count).toBe(0);
    });
});

describe('LRU eviction', () => {
    it('evicts oldest entries when type bucket exceeds MAX_MEMORIES_PER_TYPE', async () => {
        const { MAX_MEMORIES_PER_TYPE } = await import('../../src/memory/types.js');

        // Write MAX + 5 entries, each with slightly different names
        for (let i = 0; i < MAX_MEMORIES_PER_TYPE + 5; i++) {
            save(tmpDir, {
                name: `mem-${String(i).padStart(3, '0')}`,
                type: 'gotcha',
                description: `Entry ${i}`,
                body: `body ${i}`,
            });
        }

        const remaining = loadAll(tmpDir).filter(e => e.type === 'gotcha');
        expect(remaining.length).toBeLessThanOrEqual(MAX_MEMORIES_PER_TYPE);
    });
});
