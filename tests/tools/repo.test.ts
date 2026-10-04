import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execaSync } from 'execa';
import { ToolRegistry } from '../../src/tools/registry.js';
import { createRepoTools, ChangeSet, globToRegExp } from '../../src/tools/repo.js';

let root: string;
let outside: string;
let changes: ChangeSet;
let tools: ToolRegistry;

const run = async (name: string, input: Record<string, unknown>) => tools.execute({ name, input, callId: 'c' });

function write(rel: string, content: string) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), content);
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aiagentflow-repo-'));
    outside = mkdtempSync(join(tmpdir(), 'aiagentflow-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'top secret');
    write('src/app.ts', 'export const a = 1;\nexport const b = 2;\n');
    write('src/util/math.ts', 'export function add(x: number, y: number) {\n    return x + y;\n}\n');
    write('README.md', '# Demo\n');
    write('ignored/big.log', 'export const hidden = 1;\n');
    write('.gitignore', 'ignored/\n');
    execaSync('git', ['init', '-q'], { cwd: root });
    changes = new ChangeSet();
    tools = new ToolRegistry(createRepoTools({ root, changes }));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
});

describe('read_file', () => {
    it('returns numbered lines and supports offset/limit', async () => {
        const all = await run('read_file', { path: 'src/util/math.ts' });
        expect(all.content).toContain('     1\texport function add');
        const part = await run('read_file', { path: 'src/util/math.ts', offset: 2, limit: 1 });
        expect(part.content).toMatch(/^\s+2\t {4}return x \+ y;\n… 2 more line\(s\); use offset 3$/);
    });

    it('errors on missing files', async () => {
        expect(await run('read_file', { path: 'nope.ts' })).toMatchObject({ isError: true, content: 'File not found: nope.ts' });
    });
});

describe('path safety', () => {
    it.each(['../x', '/etc/passwd', 'src/../../x'])('rejects %s', async (path) => {
        const res = await run('read_file', { path });
        expect(res.isError).toBe(true);
        expect(res.content).toContain('outside the project');
    });

    it('rejects symlinks that point outside the root', async () => {
        symlinkSync(outside, join(root, 'link'));
        expect((await run('read_file', { path: 'link/secret.txt' })).content).toContain('outside the project');
        expect((await run('write_file', { path: 'link/new.txt', content: 'x' })).content).toContain('outside the project');
        expect(existsSync(join(outside, 'new.txt'))).toBe(false);
    });
});

describe('list_dir', () => {
    it('lists direct children with directories first and skips git-ignored files', async () => {
        const res = await run('list_dir', {});
        expect(res.content.split('\n')).toEqual(['src/', '.gitignore', 'README.md']);
    });

    it('lists recursively under a path', async () => {
        const res = await run('list_dir', { path: 'src', recursive: true });
        expect(res.content.split('\n')).toEqual(['app.ts', 'util/math.ts']);
    });
});

describe('grep', () => {
    it('finds matches across files with path:line output', async () => {
        const res = await run('grep', { pattern: 'export (const|function)' });
        expect(res.content.split('\n')).toEqual([
            'src/app.ts:1: export const a = 1;',
            'src/app.ts:2: export const b = 2;',
            'src/util/math.ts:1: export function add(x: number, y: number) {',
        ]);
    });

    it('filters by path and glob and caps results', async () => {
        expect((await run('grep', { pattern: 'export', path: 'src/util' })).content).toBe('src/util/math.ts:1: export function add(x: number, y: number) {');
        expect((await run('grep', { pattern: 'Demo', glob: '*.md' })).content).toBe('README.md:1: # Demo');
        expect((await run('grep', { pattern: 'export', max_results: 1 })).content).toContain('stopped at 1 matches');
    });

    it('reports invalid regexes', async () => {
        expect(await run('grep', { pattern: '(' })).toMatchObject({ isError: true });
    });
});

describe('edit_file', () => {
    it('replaces a unique match and records the change', async () => {
        const res = await run('edit_file', { path: 'src/app.ts', old_string: 'b = 2', new_string: 'b = 3' });
        expect(res).toMatchObject({ content: 'Edited src/app.ts (1 replacement).' });
        expect(readFileSync(join(root, 'src/app.ts'), 'utf-8')).toBe('export const a = 1;\nexport const b = 3;\n');
        expect(changes.files).toEqual(['src/app.ts']);
    });

    it('fails on zero or multiple matches unless replace_all', async () => {
        expect((await run('edit_file', { path: 'src/app.ts', old_string: 'zzz', new_string: 'y' })).content).toContain('not found');
        expect((await run('edit_file', { path: 'src/app.ts', old_string: 'export', new_string: 'x' })).content).toContain('matches 2 times');
        expect(changes.size).toBe(0);

        await run('edit_file', { path: 'src/app.ts', old_string: 'export ', new_string: '', replace_all: true });
        expect(readFileSync(join(root, 'src/app.ts'), 'utf-8')).toBe('const a = 1;\nconst b = 2;\n');
    });

    it('rejects an empty old_string', async () => {
        expect(await run('edit_file', { path: 'src/app.ts', old_string: '', new_string: 'x' })).toMatchObject({ isError: true });
    });
});

describe('write_file', () => {
    it('creates new files and parent directories', async () => {
        const res = await run('write_file', { path: 'src/new/thing.ts', content: 'export {};\n' });
        expect(res.content).toBe('Created src/new/thing.ts (2 lines).');
        expect(readFileSync(join(root, 'src/new/thing.ts'), 'utf-8')).toBe('export {};\n');
        expect(changes.files).toEqual(['src/new/thing.ts']);
    });

    it('refuses to overwrite existing files', async () => {
        expect((await run('write_file', { path: 'src/app.ts', content: '' })).content).toContain('already exists');
    });
});

describe('readOnly', () => {
    it('omits write tools', () => {
        expect(createRepoTools({ root, readOnly: true }).map(t => t.definition.name)).toEqual(['read_file', 'list_dir', 'grep']);
    });
});

describe('globToRegExp', () => {
    it.each([
        ['**/*.ts', 'src/a/b.ts', true],
        ['**/*.ts', 'b.ts', true],
        ['*.ts', 'src/deep/b.ts', true],
        ['src/*.ts', 'src/a/b.ts', false],
        ['src/**/*.{ts,tsx}', 'src/a/b.tsx', true],
        ['src/?.ts', 'src/ab.ts', false],
    ])('%s vs %s -> %s', (glob, path, expected) => {
        expect(globToRegExp(glob).test(path)).toBe(expected);
    });
});

describe('without git', () => {
    it('walks the filesystem and skips node_modules and .git', async () => {
        const plain = mkdtempSync(join(tmpdir(), 'aiagentflow-plain-'));
        try {
            mkdirSync(join(plain, 'node_modules/pkg'), { recursive: true });
            writeFileSync(join(plain, 'node_modules/pkg/index.js'), 'x');
            writeFileSync(join(plain, 'main.py'), 'print(1)\n');
            const reg = new ToolRegistry(createRepoTools({ root: plain }));
            expect((await reg.execute({ name: 'list_dir', input: { recursive: true }, callId: 'c' })).content).toBe('main.py');
        } finally {
            rmSync(plain, { recursive: true, force: true });
        }
    });
});
