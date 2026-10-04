import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execaSync } from 'execa';
import { changedFiles, commentableLines, getDiff } from '../../src/integrations/diff.js';

const SAMPLE = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index 111..222 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,4 +1,5 @@',
    ' import x from "x";',
    '-const a = 1;',
    '+const a = 2;',
    '+++ not a header, an added line starting with ++',
    ' const b = 3;',
    ' export { a, b };',
    '@@ -20,2 +21,3 @@ function tail() {',
    ' keep();',
    '+added();',
    ' end();',
    'diff --git a/src/new.ts b/src/new.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/new.ts',
    '@@ -0,0 +1,2 @@',
    '+line one',
    '+line two',
    'diff --git a/src/old.ts b/src/old.ts',
    'deleted file mode 100644',
    '--- a/src/old.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-gone',
    '\\ No newline at end of file',
].join('\n');

describe('changedFiles', () => {
    it('lists new-side paths and skips deleted files', () => {
        expect(changedFiles(SAMPLE)).toEqual(['src/app.ts', 'src/new.ts']);
    });
});

describe('commentableLines', () => {
    it('returns added and context lines on the new side, per hunk', () => {
        const lines = commentableLines(SAMPLE);
        expect([...lines.get('src/app.ts')!]).toEqual([1, 2, 3, 4, 5, 21, 22, 23]);
        expect([...lines.get('src/new.ts')!]).toEqual([1, 2]);
        expect(lines.has('src/old.ts')).toBe(false);
    });
});

describe('getDiff', () => {
    let repo: string;
    const git = (...args: string[]) => execaSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo });

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), 'aiagentflow-diff-'));
        git('init', '-q');
        writeFileSync(join(repo, 'a.txt'), 'one\n');
        git('add', '.');
        git('commit', '-q', '-m', 'init');
    });
    afterEach(() => rmSync(repo, { recursive: true, force: true }));

    it('reads working, staged, and range diffs', async () => {
        writeFileSync(join(repo, 'a.txt'), 'two\n');
        expect(await getDiff({ kind: 'working' }, repo)).toMatchObject({ files: ['a.txt'], label: 'uncommitted changes' });
        expect((await getDiff({ kind: 'staged' }, repo)).diff).toBe('');

        git('add', 'a.txt');
        expect((await getDiff({ kind: 'staged' }, repo)).files).toEqual(['a.txt']);

        git('commit', '-q', '-m', 'change');
        const range = await getDiff({ kind: 'range', range: 'HEAD~1..HEAD' }, repo);
        expect(range).toMatchObject({ files: ['a.txt'], label: 'HEAD~1..HEAD' });
        expect(range.diff).toContain('+two');
    });
});
