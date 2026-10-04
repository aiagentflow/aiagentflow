import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadAgentPrompt, V1_PROMPTS } from '../../src/prompts/library.js';
import { logger } from '../../src/utils/logger.js';

let root: string;
const promptsDir = () => join(root, '.aiagentflow', 'prompts');

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aiagentflow-prompts-'));
    mkdirSync(promptsDir(), { recursive: true });
});
afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
});

describe('loadAgentPrompt', () => {
    it('defaults code-writing roles to the tool-based prompt', () => {
        const coder = loadAgentPrompt(root, 'coder');
        expect(coder).toContain('edit_file');
        expect(coder).not.toContain('FILE: path/to/file.ext');
    });

    it('returns the v1 FILE: prompt in legacy mode', () => {
        expect(loadAgentPrompt(root, 'fixer', { legacyFileBlocks: true })).toContain('FILE: path/to/file.ext');
        // Roles without a legacy variant are unaffected
        expect(loadAgentPrompt(root, 'reviewer', { legacyFileBlocks: true })).toContain('submit_verdict');
    });

    it('upgrades an untouched v1 prompt file transparently', () => {
        writeFileSync(join(promptsDir(), 'tester.md'), loadAgentPrompt(root, 'tester', { legacyFileBlocks: true }));
        expect(loadAgentPrompt(root, 'tester')).toContain('write_file');
    });

    it('keeps a customised prompt but warns if it still asks for FILE: output', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        writeFileSync(join(promptsDir(), 'coder.md'), '# My coder\nAlways use FILE: blocks.');
        expect(loadAgentPrompt(root, 'coder')).toBe('# My coder\nAlways use FILE: blocks.');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('v1 "FILE:" output'));
    });

    it('upgrades untouched v1 prompts for every role', () => {
        for (const role of ['architect', 'reviewer', 'security', 'judge'] as const) {
            writeFileSync(join(promptsDir(), `${role}.md`), V1_PROMPTS[role]);
            expect(loadAgentPrompt(root, role)).not.toBe(V1_PROMPTS[role]);
        }
        expect(loadAgentPrompt(root, 'reviewer')).toContain('submit_verdict');
    });
});
