/**
 * Tests for the file parser.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseFiles, writeFiles, parseAndWriteFiles } from '../../../src/core/workflow/file-parser.js';

let testDir: string;

beforeEach(() => {
    testDir = join(tmpdir(), `ai-workflow-fp-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
    if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
    }
});

describe('parseFiles', () => {
    it('parses FILE: format with fenced code blocks', () => {
        const output = `Here is the code:

FILE: src/hello.ts
\`\`\`typescript
export function hello() {
  return "world";
}
\`\`\`

FILE: src/utils.ts
\`\`\`typescript
export const VERSION = "1.0";
\`\`\``;

        const files = parseFiles(output);
        expect(files).toHaveLength(2);
        expect(files[0].path).toBe('src/hello.ts');
        expect(files[0].content).toContain('hello()');
        expect(files[1].path).toBe('src/utils.ts');
    });

    it('returns empty array when no file blocks found', () => {
        const output = 'Just some text without any file blocks.';
        expect(parseFiles(output)).toHaveLength(0);
    });

    it('handles annotated format (```lang:path)', () => {
        const output = `\`\`\`typescript:src/index.ts
console.log("hi");
\`\`\``;

        const files = parseFiles(output);
        expect(files).toHaveLength(1);
        expect(files[0].path).toBe('src/index.ts');
    });
});

describe('writeFiles', () => {
    it('writes files and creates directories', () => {
        const files = [
            { path: 'src/deep/nested/file.ts', content: 'export const x = 1;\n' },
        ];

        const written = writeFiles(testDir, files);
        expect(written).toEqual(['src/deep/nested/file.ts']);

        const content = readFileSync(join(testDir, 'src/deep/nested/file.ts'), 'utf-8');
        expect(content).toBe('export const x = 1;\n');
    });

    it('skips files with path traversal', () => {
        const files = [
            { path: '../../../etc/passwd', content: 'bad' },
        ];

        const written = writeFiles(testDir, files);
        expect(written).toHaveLength(0);
    });
});

describe('parseAndWriteFiles', () => {
    it('parses and writes in one call', () => {
        const output = `FILE: app.ts
\`\`\`
const app = true;
\`\`\``;

        const written = parseAndWriteFiles(testDir, output);
        expect(written).toEqual(['app.ts']);
        expect(existsSync(join(testDir, 'app.ts'))).toBe(true);
    });

    it('returns empty array for output with no files', () => {
        const written = parseAndWriteFiles(testDir, 'no files here');
        expect(written).toHaveLength(0);
    });
});
