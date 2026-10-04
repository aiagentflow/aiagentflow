/**
 * The run_command tool — lets agents run tests, linters, and builds.
 *
 * Every command is checked against the CommandPolicy first. Commands that
 * need a decision are passed to `confirm`; without one (non-interactive
 * runs) they are refused. Output is truncated to keep prompts small.
 *
 * Dependency direction: tools/command.ts → tools/permissions.ts, tools/registry.ts (types), execa
 * Used by: tools/builtin.ts
 */

import { execa } from 'execa';
import type { Tool } from './registry.js';
import { checkCommand, type CommandPolicy } from './permissions.js';

/** Default command timeout. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
/** Max characters of command output returned to the model (head and tail are kept). */
const MAX_OUTPUT_CHARS = 20_000;

/** Answer from an interactive confirmation. `always` allows the same command for the rest of the run. */
export type ConfirmAnswer = 'yes' | 'always' | 'no';

export interface RunCommandOptions {
    /** Working directory for commands (project root or worktree). */
    root: string;
    policy: CommandPolicy;
    timeoutMs?: number;
    /** Ask the user about a command. Omit for non-interactive runs (ask resolves to deny). */
    confirm?: (command: string) => Promise<ConfirmAnswer>;
}

export function createRunCommandTool(options: RunCommandOptions): Tool {
    const approved = new Set<string>();
    const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

    return {
        definition: {
            name: 'run_command',
            description:
                'Run a shell command in the project root and return its exit code and output. ' +
                'Use it to run tests, linters, type checkers, and builds. Some commands may be refused by policy.',
            inputSchema: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The shell command, e.g. "npm test"' },
                },
                required: ['command'],
            },
        },
        async execute(input) {
            const command = typeof input.command === 'string' ? input.command.trim() : '';
            const decision = checkCommand(command, options.policy);

            if (decision.action === 'deny') {
                return { content: `Command refused: ${decision.reason}`, isError: true };
            }
            if (decision.action === 'ask' && !approved.has(command)) {
                const answer = options.confirm ? await options.confirm(command) : 'no';
                if (answer === 'no') {
                    const why = options.confirm ? 'the user declined it' : 'it needs approval and this run is non-interactive';
                    return { content: `Command refused: ${why}. Add it to permissions.allow to permit it.`, isError: true };
                }
                if (answer === 'always') approved.add(command);
            }

            const { output: raw, exitCode, timedOut } = await runShell(command, options.root, timeoutMs);

            const output = truncate(raw);
            if (timedOut) {
                return { content: `Timed out after ${timeoutMs / 1000}s.\n${output}`, isError: true };
            }
            return { content: `Exit code: ${exitCode}\n${output || '(no output)'}`, isError: exitCode !== 0 };
        },
    };
}

/**
 * Run a shell command in its own process group so a timeout kills the whole
 * tree; killing only the shell would leave children holding the output pipe.
 */
async function runShell(command: string, cwd: string, timeoutMs: number): Promise<{ output: string; exitCode: number; timedOut: boolean }> {
    const subprocess = execa(command, {
        cwd,
        shell: true,
        reject: false,
        all: true,
        stdin: 'ignore',
        detached: process.platform !== 'win32',
        env: { ...process.env, FORCE_COLOR: '0', CI: process.env.CI ?? '1' },
    });

    const kill = () => {
        try {
            if (process.platform !== 'win32' && subprocess.pid) process.kill(-subprocess.pid, 'SIGKILL');
            else subprocess.kill('SIGKILL');
        } catch {
            // Already exited
        }
    };

    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        kill();
    }, timeoutMs);
    trackChild(kill);

    try {
        const result = await subprocess;
        return { output: result.all ?? '', exitCode: result.exitCode ?? 1, timedOut };
    } finally {
        clearTimeout(timer);
        untrackChild(kill);
    }
}

// ── Cleanup on exit ──
// Detached children do not receive the terminal's Ctrl+C, so kill them
// ourselves if aiagentflow is interrupted or exits mid-command.

const runningChildren = new Set<() => void>();

function killAll(): void {
    for (const kill of runningChildren) kill();
}

function onSignal(signal: NodeJS.Signals): void {
    killAll();
    removeExitHandlers();
    process.kill(process.pid, signal); // re-raise with default behaviour
}

function trackChild(kill: () => void): void {
    if (runningChildren.size === 0) {
        process.on('exit', killAll);
        process.on('SIGINT', onSignal);
        process.on('SIGTERM', onSignal);
    }
    runningChildren.add(kill);
}

function untrackChild(kill: () => void): void {
    runningChildren.delete(kill);
    if (runningChildren.size === 0) removeExitHandlers();
}

function removeExitHandlers(): void {
    process.off('exit', killAll);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
}

/** Keep the start and end of long output; failures usually show up at the end. */
function truncate(output: string): string {
    if (output.length <= MAX_OUTPUT_CHARS) return output;
    const half = MAX_OUTPUT_CHARS / 2;
    const dropped = output.length - MAX_OUTPUT_CHARS;
    return `${output.slice(0, half)}\n… ${dropped} characters omitted …\n${output.slice(-half)}`;
}
