/**
 * Command permission policy for the run_command tool.
 *
 * A command is checked against deny patterns, then allow patterns, then the
 * policy mode. Compound commands (&&, ||, ;, |, newlines) are split and every
 * segment must pass, so an allowed prefix cannot smuggle in another command.
 *
 * Patterns are matched against the whole command (whitespace collapsed);
 * `*` matches any characters. "npm test" matches only "npm test";
 * "npm run *" matches any npm script.
 *
 * Dependency direction: tools/permissions.ts → nothing (leaf module)
 * Used by: tools/command.ts, tools/builtin.ts, core/config/schema.ts
 */

/** Names of all built-in tools (permissions.tools.<role> may list these). */
export const BUILTIN_TOOL_NAMES = ['read_file', 'list_dir', 'grep', 'edit_file', 'write_file', 'run_command'] as const;
export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

/** How commands that match no allow/deny pattern are handled. */
export type PermissionMode = 'ask' | 'auto' | 'deny';

export interface CommandPolicy {
    readonly mode: PermissionMode;
    readonly allow: readonly string[];
    readonly deny: readonly string[];
}

/** Decision for a single command. */
export type CommandDecision =
    | { readonly action: 'allow' }
    | { readonly action: 'deny'; readonly reason: string }
    | { readonly action: 'ask' };

/** Commands that are refused even in auto mode unless the user removes them from the deny list. */
export const DEFAULT_DENY: readonly string[] = [
    'sudo *',
    'su *',
    'rm -rf /*',
    'rm -rf ~*',
    'rm -fr /*',
    'git push*',
    'git reset --hard*',
    'git clean *',
    'git checkout -- *',
    'npm publish*',
    'pnpm publish*',
    'yarn publish*',
    'curl *',
    'wget *',
    'ssh *',
    'scp *',
    'mkfs*',
    'dd *',
    'shutdown*',
    'reboot*',
    'chmod -R 777 *',
];

/** Constructs that hide what will actually run. Never auto-allowed by an allow pattern. */
const OPAQUE_CONSTRUCTS = /\$\(|`|<\(|>\(/;

/**
 * Decide whether `command` may run under `policy`.
 */
export function checkCommand(command: string, policy: CommandPolicy): CommandDecision {
    const normalized = normalize(command);
    if (!normalized) return { action: 'deny', reason: 'Empty command' };

    const segments = splitCommand(normalized);

    for (const target of [normalized, ...segments]) {
        const hit = policy.deny.find(p => matchesPattern(target, p));
        if (hit) return { action: 'deny', reason: `Command matches deny rule "${hit}"` };
    }

    const allAllowed = !OPAQUE_CONSTRUCTS.test(normalized)
        && segments.every(seg => policy.allow.some(p => matchesPattern(seg, p)));
    if (allAllowed) return { action: 'allow' };

    switch (policy.mode) {
        case 'auto':
            return { action: 'allow' };
        case 'deny':
            return { action: 'deny', reason: 'Command is not in the allow list (permissions.mode is "deny")' };
        case 'ask':
            return { action: 'ask' };
    }
}

/** Split a shell command on &&, ||, ;, | and newlines (quotes are respected). */
export function splitCommand(command: string): string[] {
    const segments: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;

    for (let i = 0; i < command.length; i++) {
        const c = command[i]!;
        if (quote) {
            if (c === quote) quote = null;
            current += c;
            continue;
        }
        if (c === '"' || c === "'") {
            quote = c;
            current += c;
            continue;
        }
        const two = command.slice(i, i + 2);
        if (two === '&&' || two === '||') {
            segments.push(current);
            current = '';
            i++;
            continue;
        }
        // A lone "&" in "2>&1" or ">&" is a redirection, not a separator
        if (c === ';' || c === '\n' || (c === '|' && command[i + 1] !== '|')) {
            segments.push(current);
            current = '';
            continue;
        }
        current += c;
    }
    segments.push(current);
    return segments.map(normalize).filter(Boolean);
}

/** Whole-string match where `*` matches any run of characters. */
export function matchesPattern(command: string, pattern: string): boolean {
    const re = normalize(pattern)
        .split('*')
        .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
    return new RegExp(`^${re}$`, 's').test(command);
}

function normalize(s: string): string {
    return s.trim().replace(/[ \t]+/g, ' ');
}
