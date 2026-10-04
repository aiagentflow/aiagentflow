/**
 * External agent steps: hand a code-writing step to another agent CLI
 * (Claude Code, OpenCode, or any command), then let aiagentflow's checks
 * and gates judge the result as usual.
 *
 * The external agent works in the run's directory (the worktree, by default).
 * Changed files are detected from git, so any CLI that edits files works.
 *
 * Dependency direction: external.ts → execa, zod, core/errors, providers/types (types)
 * Used by: workflow executor, workflow definition schema
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { z } from 'zod';
import { ProviderError } from '../core/errors.js';
import type { TokenUsage } from '../providers/types.js';

export const EXTERNAL_CLIS = ['claude-code', 'opencode', 'command'] as const;
export type ExternalCli = (typeof EXTERNAL_CLIS)[number];

export const externalAgentSchema = z.object({
    /** Which CLI to run. `command` runs `args` as given, with `{prompt}` replaced. */
    cli: z.enum(EXTERNAL_CLIS),
    /** Model to request (passed as the CLI's model flag). */
    model: z.string().optional(),
    /** Extra arguments; for `command`, the full command line (first item is the program). */
    args: z.array(z.string()).default([]),
    /** Path to the CLI binary, if it is not on PATH (not used by `command`). */
    bin: z.string().optional(),
    /** Minutes before the CLI is stopped (default 30). */
    timeoutMinutes: z.number().positive().max(240).default(30),
});

export type ExternalAgentConfig = z.infer<typeof externalAgentSchema>;

/** What an external agent run produced. */
export interface ExternalRunResult {
    /** The agent's final message. */
    summary: string;
    /** Files created, modified, or deleted during the run. */
    files: string[];
    /** `git diff` of tracked changes, truncated. */
    diff: string;
    costUsd?: number;
    usage?: TokenUsage;
    durationMs: number;
}

/** Most diff characters kept in the session. */
const MAX_DIFF_CHARS = 50_000;

/** The command line for a CLI. Exported for tests and dry runs. */
export function buildCommand(config: ExternalAgentConfig, prompt: string): { file: string; args: string[] } {
    switch (config.cli) {
        case 'claude-code':
            return {
                file: config.bin ?? 'claude',
                args: ['-p', prompt, '--output-format', 'json', '--permission-mode', 'acceptEdits',
                    ...(config.model ? ['--model', config.model] : []), ...config.args],
            };
        case 'opencode':
            return {
                file: config.bin ?? 'opencode',
                args: ['run', '--format', 'json', ...(config.model ? ['--model', config.model] : []), ...config.args, prompt],
            };
        case 'command': {
            if (config.args.length === 0) throw new ProviderError('external cli "command" needs args: the command line to run');
            const [file, ...rest] = config.args.map(a => a.replaceAll('{prompt}', prompt));
            return { file: file!, args: rest };
        }
    }
}

/**
 * Run an external agent in `cwd` and collect what it changed.
 * @throws {ProviderError} if the CLI is missing, fails, or times out
 */
export async function runExternalAgent(config: ExternalAgentConfig, prompt: string, cwd: string): Promise<ExternalRunResult> {
    const started = Date.now();
    const before = await snapshot(cwd);
    const { file, args } = buildCommand(config, prompt);

    const result = await execa(file, args, {
        cwd,
        reject: false,
        stdin: 'ignore',
        timeout: config.timeoutMinutes * 60_000,
        env: { ...process.env, CI: process.env.CI ?? '1' },
    });

    if (result.timedOut) {
        throw new ProviderError(`${config.cli} timed out after ${config.timeoutMinutes} minutes`, { cli: config.cli });
    }
    if ((result as { code?: string }).code === 'ENOENT') {
        throw new ProviderError(`${file} not found. Install it or set external.bin in the workflow.`, { cli: config.cli });
    }
    if (result.exitCode !== 0) {
        const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(-10).join('\n');
        throw new ProviderError(`${config.cli} exited with code ${result.exitCode}${detail ? `:\n${detail}` : ''}`, { cli: config.cli });
    }

    const parsed = parseOutput(config.cli, result.stdout);
    const files = changedFiles(before, await snapshot(cwd));
    const diff = files.length > 0
        ? (await execa('git', ['diff', '--no-color', '--', ...files], { cwd, reject: false })).stdout
        : '';

    return {
        ...parsed,
        files,
        diff: diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n... (diff truncated)` : diff,
        durationMs: Date.now() - started,
    };
}

/** Extract the final message, cost, and usage from a CLI's output. Unknown shapes fall back to raw text. */
export function parseOutput(cli: ExternalCli, stdout: string): Pick<ExternalRunResult, 'summary' | 'costUsd' | 'usage'> {
    if (cli === 'claude-code') {
        try {
            const json = JSON.parse(stdout) as { result?: string; total_cost_usd?: number; usage?: Record<string, number> };
            const input = (json.usage?.input_tokens ?? 0) + (json.usage?.cache_read_input_tokens ?? 0) + (json.usage?.cache_creation_input_tokens ?? 0);
            const output = json.usage?.output_tokens ?? 0;
            return {
                summary: json.result ?? '',
                ...(typeof json.total_cost_usd === 'number' ? { costUsd: json.total_cost_usd } : {}),
                ...(json.usage ? { usage: { promptTokens: input, completionTokens: output, totalTokens: input + output } } : {}),
            };
        } catch {
            return { summary: stdout.trim() };
        }
    }

    if (cli === 'opencode') {
        // JSON events, one per line; keep the text of the last text-bearing event
        let summary = '';
        for (const line of stdout.split('\n')) {
            try {
                const text = findText(JSON.parse(line));
                if (text) summary = text;
            } catch {
                // not JSON
            }
        }
        return { summary: summary || stdout.trim() };
    }

    return { summary: stdout.trim() };
}

function findText(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string' && record.text.trim()) return record.text;
    for (const nested of Object.values(record)) {
        const found = findText(nested);
        if (found) return found;
    }
    return undefined;
}

// ── Change detection ──

/** Hash of every modified or untracked file (git-ignored files excluded). */
async function snapshot(cwd: string): Promise<Map<string, string>> {
    const { stdout } = await execa('git', ['ls-files', '--modified', '--others', '--exclude-standard', '-z'], { cwd, reject: false });
    const hashes = new Map<string, string>();
    for (const file of stdout.split('\0').filter(Boolean)) {
        const path = join(cwd, file);
        hashes.set(file, existsSync(path) ? createHash('sha1').update(readFileSync(path)).digest('hex') : 'deleted');
    }
    return hashes;
}

function changedFiles(before: Map<string, string>, after: Map<string, string>): string[] {
    const files = new Set<string>();
    for (const [file, hash] of after) if (before.get(file) !== hash) files.add(file);
    for (const file of before.keys()) if (!after.has(file)) files.add(file);
    return [...files].filter(f => !f.startsWith('.aiagentflow/')).sort();
}
