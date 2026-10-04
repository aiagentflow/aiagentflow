import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRunCommandTool } from '../../src/tools/command.js';
import { createBuiltinTools, commandPolicyFromConfig } from '../../src/tools/builtin.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { DEFAULT_DENY, type CommandPolicy } from '../../src/tools/permissions.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'aiagentflow-cmd-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const policy = (over: Partial<CommandPolicy> = {}): CommandPolicy => ({ mode: 'deny', allow: ['node *'], deny: [...DEFAULT_DENY], ...over });
const call = (command: string) => ({ name: 'run_command', input: { command }, callId: 'c' });

describe('run_command', () => {
    it('runs allowed commands in the root and reports exit code and output', async () => {
        writeFileSync(join(root, 'ok.js'), 'console.log("hello"); console.error("warn");');
        const reg = new ToolRegistry([createRunCommandTool({ root, policy: policy() })]);
        const res = await reg.execute(call('node ok.js'));
        expect(res.isError).toBeUndefined();
        expect(res.content).toMatch(/^Exit code: 0\nhello\nwarn$/);
    });

    it('marks non-zero exits as errors', async () => {
        const reg = new ToolRegistry([createRunCommandTool({ root, policy: policy() })]);
        const res = await reg.execute(call('node -e "process.exit(3)"'));
        expect(res).toMatchObject({ isError: true, content: expect.stringContaining('Exit code: 3') });
    });

    it('refuses denied commands without running them', async () => {
        const reg = new ToolRegistry([createRunCommandTool({ root, policy: policy({ mode: 'auto' }) })]);
        const res = await reg.execute(call('git push origin main'));
        expect(res).toMatchObject({ isError: true, content: expect.stringContaining('deny rule') });
    });

    it('refuses ask-mode commands when non-interactive', async () => {
        const reg = new ToolRegistry([createRunCommandTool({ root, policy: policy({ mode: 'ask' }) })]);
        const res = await reg.execute(call('touch made.txt'));
        expect(res.content).toContain('non-interactive');
        expect(existsSync(join(root, 'made.txt'))).toBe(false);
    });

    it('asks once and remembers "always"', async () => {
        const confirm = vi.fn().mockResolvedValue('always');
        const reg = new ToolRegistry([createRunCommandTool({ root, policy: policy({ mode: 'ask' }), confirm })]);
        await reg.execute(call('touch a.txt'));
        await reg.execute(call('touch a.txt'));
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(existsSync(join(root, 'a.txt'))).toBe(true);

        confirm.mockResolvedValueOnce('no');
        const denied = await reg.execute(call('touch b.txt'));
        expect(denied.content).toContain('user declined');
        expect(existsSync(join(root, 'b.txt'))).toBe(false);
    });

    it('times out long commands', async () => {
        const reg = new ToolRegistry([createRunCommandTool({ root, policy: policy(), timeoutMs: 200 })]);
        const res = await reg.execute(call('node -e "setTimeout(() => {}, 5000)"'));
        expect(res).toMatchObject({ isError: true, content: expect.stringContaining('Timed out') });
    });
});

describe('createBuiltinTools', () => {
    const names = (role: Parameters<typeof createBuiltinTools>[0], allowedTools?: string[]) =>
        createBuiltinTools(role, { root, policy: policy(), allowedTools }).map(t => t.definition.name);

    it('gives judging roles read-only tools by default', () => {
        expect(names('reviewer')).toEqual(['read_file', 'list_dir', 'grep']);
        expect(names('security')).toEqual(['read_file', 'list_dir', 'grep']);
        expect(names('coder')).toEqual(['read_file', 'list_dir', 'grep', 'edit_file', 'write_file', 'run_command']);
    });

    it('honours a per-role override', () => {
        expect(names('reviewer', ['read_file', 'run_command'])).toEqual(['read_file', 'run_command']);
    });
});

describe('commandPolicyFromConfig', () => {
    it('adds workflow commands to the allow list', () => {
        const p = commandPolicyFromConfig({ mode: 'ask', allow: ['make'], deny: [] }, ['npm test', undefined, ' ', 'npm run lint']);
        expect(p.allow).toEqual(['make', 'npm test', 'npm run lint']);
    });
});
