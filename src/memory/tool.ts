/**
 * The `remember` tool — lets agents write to the project memory store.
 *
 * This is a synthetic tool (not backed by an MCP server). It is registered
 * in the provider's tool-use loop and handled locally by the runner before
 * the result is sent back to the LLM.
 *
 * Agents can only write types their role is authorized for (see MEMORY_WRITE_ROLES).
 * Bodies are capped at MAX_MEMORY_BODY_CHARS to prevent token bloat.
 *
 * Dependency direction: memory/tool.ts → memory/types.ts, memory/store.ts, providers/types.ts
 * Used by: agents/factory.ts, core/workflow/runner.ts
 */

import type { ToolDefinition, ToolCall, ToolResult } from '../providers/types.js';
import type { AgentRole } from '../agents/types.js';
import { save } from './store.js';
import {
    MEMORY_TYPES,
    MEMORY_WRITE_ROLES,
    MAX_MEMORY_BODY_CHARS,
    type MemoryType,
} from './types.js';
import { logger } from '../utils/logger.js';

export const REMEMBER_TOOL_NAME = 'remember';

/** Tool definition passed to the provider's tool-use loop. */
export const rememberToolDefinition: ToolDefinition = {
    name: REMEMBER_TOOL_NAME,
    description:
        'Save a piece of project knowledge to the persistent memory store. ' +
        'Use this to record architectural patterns, coding conventions, key decisions, ' +
        'known gotchas, or important references so future agents can benefit from your findings.',
    inputSchema: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                description:
                    'A short unique slug for this memory (kebab-case, e.g. "state-machine-pattern"). ' +
                    'If a memory with this name already exists it will be updated.',
                maxLength: 80,
            },
            type: {
                type: 'string',
                enum: MEMORY_TYPES as unknown as string[],
                description:
                    'Memory category: architecture | convention | decision | gotcha | reference',
            },
            description: {
                type: 'string',
                description:
                    'One-line summary shown in the memory index (max 200 chars).',
                maxLength: 200,
            },
            body: {
                type: 'string',
                description:
                    'Full markdown body. Be concise — max 4000 characters. ' +
                    'Include enough detail that a future agent can act on this without re-reading the original code.',
            },
        },
        required: ['name', 'type', 'description', 'body'],
    },
};

/**
 * Roles that may use the remember tool.
 * Derived from MEMORY_WRITE_ROLES — union of all roles that can write at least one type.
 */
export const REMEMBER_ELIGIBLE_ROLES: ReadonlySet<AgentRole> = new Set(
    Object.values(MEMORY_WRITE_ROLES).flat() as AgentRole[],
);

/**
 * Handle a `remember` tool call from an agent.
 * Validates input, checks role authorization, and writes to the store.
 *
 * @param call - The ToolCall from the provider loop
 * @param role - The agent role making the call
 * @param projectRoot - Project root for file I/O
 * @returns ToolResult with success or error content
 */
export function handleRememberCall(
    call: ToolCall,
    role: AgentRole,
    projectRoot: string,
): ToolResult {
    const { name, type, description, body } = call.input as {
        name: string;
        type: string;
        description: string;
        body: string;
    };

    // Validate type
    if (!MEMORY_TYPES.includes(type as MemoryType)) {
        return {
            callId: call.callId,
            content: `Error: unknown memory type "${type}". Valid types: ${MEMORY_TYPES.join(', ')}`,
            isError: true,
        };
    }

    const memType = type as MemoryType;

    // Check role authorization
    if (!MEMORY_WRITE_ROLES[memType].includes(role)) {
        return {
            callId: call.callId,
            content: `Error: the ${role} role is not authorized to write "${memType}" memories.`,
            isError: true,
        };
    }

    // Validate body length
    if (!body || body.length > MAX_MEMORY_BODY_CHARS) {
        return {
            callId: call.callId,
            content: `Error: body must be between 1 and ${MAX_MEMORY_BODY_CHARS} characters (got ${body?.length ?? 0}).`,
            isError: true,
        };
    }

    // Validate description
    if (!description || description.length > 200) {
        return {
            callId: call.callId,
            content: `Error: description must be between 1 and 200 characters.`,
            isError: true,
        };
    }

    try {
        const saved = save(projectRoot, {
            name: String(name),
            type: memType,
            description: String(description),
            body: String(body),
        });

        logger.info(`Memory saved: ${saved.name} (${memType})`);

        return {
            callId: call.callId,
            content: `Memory "${saved.name}" saved successfully (type: ${memType}).`,
        };
    } catch (err) {
        return {
            callId: call.callId,
            content: `Error saving memory: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
        };
    }
}
