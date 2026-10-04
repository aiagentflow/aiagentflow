import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execaSync } from 'execa';
import { buildCommand, parseOutput, runExternalAgent, externalAgentSchema } from '../../src/agents/external.js';
import { ProviderError } from '../../src/core/errors.js';
import { parseWorkflow } from '../../src/core/workflow/definition.js';

const config = (over: object = {}) => externalAgentSchema.parse({ cli: 'claude-code', ...over });

describe('buildCommand', () => {
    it('builds headless invocations for each CLI', () => {
        expect(buildCommand(config({ model: 'claude-sonnet-5-5' }), 'do it')).toEqual({
            file: 'claude',
            args: ['-p', 'do it', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--model', 'claude-sonnet-5-5'],
        });
        expect(buildCommand(config({ cli: 'opencode', model: 'anthropic/claude-opus-5-5', bin: '/opt/oc' }), 'do it')).toEqual({
            file: '/opt/oc',
            args: ['run', '--format', 'json', '--model', 'anthropic/claude-opus-5-5', 'do it'],
        });
        expect(buildCommand(config({ cli: 'command', args: ['codex', 'exec', '--full-auto', '{prompt}'] }), 'do it')).toEqual({
            file: 'codex', args: ['exec', '--full-auto', 'do it'],
        });
        expect(() => buildCommand(config({ cli: 'command' }), 'x')).toThrow(ProviderError);
    });
});

describe('parseOutput', () => {
    it('reads Claude Code JSON results, including cost and cached input', () => {
        const out = JSON.stringify({ type: 'result', result: 'Done.', total_cost_usd: 0.42, usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 50 } });
        expect(parseOutput('claude-code', out)).toEqual({ summary: 'Done.', costUsd: 0.42, usage: { promptTokens: 1000, completionTokens: 50, totalTokens: 1050 } });
        expect(parseOutput('claude-code', 'plain text')).toEqual({ summary: 'plain text' });
    });

    it('takes the last text from OpenCode JSON events and raw output otherwise', () => {
        const events = [
            JSON.stringify({ type: 'text', part: { text: 'Looking...' } }),
            JSON.stringify({ type: 'tool', part: { tool: 'edit' } }),
            JSON.stringify({ type: 'text', part: { text: 'All done.' } }),
        ].join('\n');
        expect(parseOutput('opencode', events).summary).toBe('All done.');
        expect(parseOutput('command', '  finished  \n')).toEqual({ summary: 'finished' });
    });
});

describe('runExternalAgent', () => {
    let repo: string;
    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), 'aiagentflow-ext-'));
        writeFileSync(join(repo, 'a.txt'), 'one\n');
        execaSync('git', ['init', '-q'], { cwd: repo });
        execaSync('git', ['add', '.'], { cwd: repo });
        execaSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: repo });
    });
    afterEach(() => rmSync(repo, { recursive: true, force: true }));

    function fakeCli(body: string): string {
        const path = join(repo, '..', `fake-${Math.random().toString(36).slice(2)}.cjs`);
        writeFileSync(path, `#!/usr/bin/env node\n${body}`);
        chmodSync(path, 0o755);
        return path;
    }

    it('reports changed files, the diff, and cost', async () => {
        const bin = fakeCli(`
            const fs = require('fs');
            fs.writeFileSync('a.txt', 'two\\n');
            fs.writeFileSync('b.txt', 'new\\n');
            console.log(JSON.stringify({ result: 'Changed a, added b', total_cost_usd: 0.1 }));
        `);
        const run = await runExternalAgent(config({ bin }), 'go', repo);
        expect(run.files).toEqual(['a.txt', 'b.txt']);
        expect(run.diff).toContain('+two');
        expect(run).toMatchObject({ summary: 'Changed a, added b', costUsd: 0.1 });
    });

    it('fails clearly when the CLI is missing or exits non-zero', async () => {
        await expect(runExternalAgent(config({ bin: join(repo, 'nope') }), 'go', repo)).rejects.toThrow(/not found/);
        const bin = fakeCli(`console.error('auth required'); process.exit(3);`);
        await expect(runExternalAgent(config({ bin }), 'go', repo)).rejects.toThrow(/exited with code 3:\nauth required/);
    });
});

describe('workflow schema', () => {
    it('allows external agents only on code-writing steps', () => {
        expect(() => parseWorkflow('name: x\nsteps:\n  - id: a\n    agent: coder\n    external:\n      cli: claude-code\n', 'x')).not.toThrow();
        expect(() => parseWorkflow('name: x\nsteps:\n  - id: a\n    agent: reviewer\n    external:\n      cli: opencode\n', 'x'))
            .toThrow('only coder, fixer, and tester steps can run an external agent');
    });
});
