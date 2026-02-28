/**
 * Tests for context document loading and formatting.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
    loadContextDocuments,
    formatContextForAgent,
    type ContextDocument,
} from '../../../src/core/workflow/context-loader.js';

const TEST_ROOT = join(import.meta.dirname, '../../.tmp-context-test');
const CONTEXT_DIR = join(TEST_ROOT, '.aiagentflow', 'context');

beforeEach(() => {
    mkdirSync(CONTEXT_DIR, { recursive: true });
});

afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('loadContextDocuments', () => {
    it('loads explicit file paths', () => {
        const docPath = join(TEST_ROOT, 'spec.md');
        writeFileSync(docPath, '# API Spec\nGET /users');

        const docs = loadContextDocuments(TEST_ROOT, ['spec.md']);

        expect(docs).toHaveLength(1);
        expect(docs[0]!.name).toBe('spec.md');
        expect(docs[0]!.content).toContain('GET /users');
    });

    it('auto-discovers .md and .txt files in context directory', () => {
        writeFileSync(join(CONTEXT_DIR, 'requirements.md'), '# Requirements');
        writeFileSync(join(CONTEXT_DIR, 'notes.txt'), 'Some notes');
        writeFileSync(join(CONTEXT_DIR, 'data.json'), '{}'); // Should be ignored

        const docs = loadContextDocuments(TEST_ROOT);

        expect(docs).toHaveLength(2);
        const names = docs.map(d => d.name).sort();
        expect(names).toEqual(['notes.txt', 'requirements.md']);
    });

    it('deduplicates files loaded both explicitly and from auto-discover', () => {
        const filePath = join(CONTEXT_DIR, 'shared.md');
        writeFileSync(filePath, '# Shared doc');

        // Load the same file explicitly and via auto-discover
        const docs = loadContextDocuments(TEST_ROOT, [filePath]);

        expect(docs).toHaveLength(1);
        expect(docs[0]!.name).toBe('shared.md');
    });

    it('warns and skips missing explicit files', () => {
        const docs = loadContextDocuments(TEST_ROOT, ['nonexistent.md']);

        expect(docs).toHaveLength(0);
    });

    it('returns empty array when no context exists', () => {
        rmSync(CONTEXT_DIR, { recursive: true, force: true });

        const docs = loadContextDocuments(TEST_ROOT);

        expect(docs).toHaveLength(0);
    });

    it('loads both explicit and auto-discovered files', () => {
        const explicitPath = join(TEST_ROOT, 'explicit.md');
        writeFileSync(explicitPath, '# Explicit');
        writeFileSync(join(CONTEXT_DIR, 'auto.md'), '# Auto');

        const docs = loadContextDocuments(TEST_ROOT, ['explicit.md']);

        expect(docs).toHaveLength(2);
        const names = docs.map(d => d.name).sort();
        expect(names).toEqual(['auto.md', 'explicit.md']);
    });
});

describe('formatContextForAgent', () => {
    it('returns empty string for no documents', () => {
        expect(formatContextForAgent([])).toBe('');
    });

    it('formats documents with markdown headers', () => {
        const docs: ContextDocument[] = [
            { source: '/path/spec.md', name: 'spec.md', content: '# API Spec\nGET /users' },
            { source: '/path/arch.md', name: 'arch.md', content: '# Architecture' },
        ];

        const result = formatContextForAgent(docs);

        expect(result).toContain('## Reference Documents');
        expect(result).toContain('### spec.md');
        expect(result).toContain('GET /users');
        expect(result).toContain('### arch.md');
        expect(result).toContain('# Architecture');
    });
});
