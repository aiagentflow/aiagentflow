/**
 * Built-in tools per agent role.
 *
 * Combines the repo tools and run_command, filtered by the role's allowlist
 * (`permissions.tools.<role>` in config, or the defaults below).
 *
 * Dependency direction: tools/builtin.ts → tools/repo, tools/command, tools/permissions, agents/types
 * Used by: agents/factory.ts
 */

import type { AgentRole } from '../agents/types.js';
import type { Tool } from './registry.js';
import { createRepoTools, type ChangeSet } from './repo.js';
import { createRunCommandTool, type ConfirmAnswer } from './command.js';
import { BUILTIN_TOOL_NAMES, type BuiltinToolName, type CommandPolicy } from './permissions.js';

const READ: BuiltinToolName[] = ['read_file', 'list_dir', 'grep'];
const ALL: BuiltinToolName[] = [...BUILTIN_TOOL_NAMES];

/**
 * Default built-in tools per role. Roles that judge work are read-only so
 * they cannot change what they are judging.
 */
export const DEFAULT_ROLE_TOOLS: Readonly<Record<AgentRole, readonly BuiltinToolName[]>> = {
    architect: READ,
    coder: ALL,
    reviewer: READ,
    security: READ,
    tester: ALL,
    fixer: ALL,
    judge: READ,
};

export interface BuiltinToolsOptions {
    /** Project root or worktree the tools operate in. */
    root: string;
    /** Records files written by edit_file / write_file. */
    changes?: ChangeSet;
    policy: CommandPolicy;
    /** Overrides DEFAULT_ROLE_TOOLS for this role. */
    allowedTools?: readonly string[];
    commandTimeoutMs?: number;
    /** Interactive approval for commands that need it. Omit in non-interactive runs. */
    confirm?: (command: string) => Promise<ConfirmAnswer>;
}

/** Built-in tools the given role may use. */
export function createBuiltinTools(role: AgentRole, options: BuiltinToolsOptions): Tool[] {
    const allowed = new Set(options.allowedTools ?? DEFAULT_ROLE_TOOLS[role]);
    const tools: Tool[] = [
        ...createRepoTools({ root: options.root, changes: options.changes }),
        createRunCommandTool({
            root: options.root,
            policy: options.policy,
            timeoutMs: options.commandTimeoutMs,
            confirm: options.confirm,
        }),
    ];
    return tools.filter(t => allowed.has(t.definition.name));
}

/**
 * Build the run_command policy from config. Commands the workflow itself runs
 * (test, lint, format) are always allowed so agents can verify their work.
 */
export function commandPolicyFromConfig(
    permissions: { mode: CommandPolicy['mode']; allow: readonly string[]; deny: readonly string[] },
    workflowCommands: ReadonlyArray<string | undefined>,
): CommandPolicy {
    const auto = workflowCommands.filter((c): c is string => Boolean(c?.trim()));
    return { mode: permissions.mode, allow: [...permissions.allow, ...auto], deny: permissions.deny };
}
