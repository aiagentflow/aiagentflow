import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRepoMap, extractSymbols } from '../../../src/core/workflow/repo-map.js';
import { loadSourceFiles, formatSourcesForAgent } from '../../../src/core/workflow/context-loader.js';

describe('extractSymbols', () => {
    it('finds TypeScript exports in source order', () => {
        const ts = [
            'import x from "y";',
            'export interface User { id: string }',
            'const internal = 1;',
            'export async function load() {}',
            'export default class Store {}',
            'export const VERSION = "1";',
            'export type Id = string;',
            'export enum Color { Red }',
        ].join('\n');
        expect(extractSymbols('a.ts', ts)).toEqual(['iface User', 'fn load', 'class Store', 'const VERSION', 'type Id', 'enum Color']);
    });

    it.each([
        ['a.py', 'import os\nclass Repo:\n    def method(self): pass\ndef build():\n    pass\ndef _private(): pass\n', ['class Repo', 'fn build']],
        ['a.go', 'package x\nfunc (s *Server) Start() {}\nfunc helper() {}\ntype Config struct {}\n', ['Start', 'Config']],
        ['a.rs', 'pub fn run() {}\nfn hidden() {}\npub struct Engine;\npub(crate) enum Mode {}\n', ['fn run', 'struct Engine', 'enum Mode']],
        ['A.java', 'package a;\npublic final class Service {\n  public void go() {}\n}\n', ['class Service']],
        ['notes.md', '# Title', []],
    ])('%s', (file, content, expected) => {
        expect(extractSymbols(file, content)).toEqual(expected);
    });
});

describe('buildRepoMap', () => {
    let root: string;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'aiagentflow-map-'));
        for (let i = 0; i < 30; i++) {
            const body = Array.from({ length: 40 }, (_, j) => `    const v${j} = compute(${j}); // line ${j}`).join('\n');
            mkdirSync(join(root, 'src', `mod${i % 5}`), { recursive: true });
            writeFileSync(join(root, 'src', `mod${i % 5}`, `file${i}.ts`), `export function handler${i}() {\n${body}\n}\nexport const NAME_${i} = 'x';\n`);
        }
        writeFileSync(join(root, 'README.md'), '# Fixture\n');
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it('groups files by directory with symbols, root files first', async () => {
        const map = await buildRepoMap(root);
        const lines = map.split('\n');
        expect(lines[0]).toBe('## Repository Map');
        expect(lines.indexOf('./')).toBeLessThan(lines.indexOf('src/mod0/'));
        expect(map).toContain('  README.md\n');
        expect(map).toContain('  file0.ts: fn handler0, const NAME_0');
    });

    it('is much smaller than inlining the full sources', async () => {
        const map = await buildRepoMap(root);
        const full = formatSourcesForAgent(loadSourceFiles(root, ['src/**/*.ts']));
        expect(map.length).toBeLessThan(full.length / 5);
    });

    it('drops symbols first when over budget', async () => {
        const count = (map: string) => (map.match(/fn handler/g) ?? []).length;
        expect(count(await buildRepoMap(root))).toBe(30);
        const trimmed = await buildRepoMap(root, { maxTokens: 150 });
        expect(count(trimmed)).toBeGreaterThan(0);
        expect(count(trimmed)).toBeLessThan(30);
        expect(trimmed).not.toContain('more file(s)');
    });

    it('cuts the file list when names alone exceed the budget', async () => {
        const tiny = await buildRepoMap(root, { maxTokens: 60 });
        expect(tiny).not.toContain('fn handler');
        expect(tiny).toMatch(/… \d+ more file\(s\); use list_dir to explore$/);
    });

    it('returns an empty string for an empty project', async () => {
        const empty = mkdtempSync(join(tmpdir(), 'aiagentflow-empty-'));
        expect(await buildRepoMap(empty)).toBe('');
        rmSync(empty, { recursive: true, force: true });
    });
});
