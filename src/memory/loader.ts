/**
 * Memory loader — filters and formats memories for injection into agent prompts.
 *
 * Each agent role sees only the memory types relevant to its job:
 *   - Architect: architecture, decision, reference, convention
 *   - Coder: architecture, convention, reference
 *   - Reviewer: convention, gotcha, architecture
 *   etc.
 *
 * Two tiers of injection:
 *   1. Memory index — all relevant memories as a compact name + description list
 *   2. Full bodies — included for memories whose type matches the agent
 *
 * Dependency direction: memory/loader.ts → memory/store.ts, memory/types.ts
 * Used by: agents/base.ts (via runner), workflow runner
 */

import type { AgentRole } from '../agents/types.js';
import { loadAll } from './store.js';
import { MEMORY_READ_ROLES, type MemoryEntry, type MemoryType } from './types.js';

export interface LoadedMemories {
    /** Compact index: name + description for all relevant memories. */
    index: Array<{ name: string; type: MemoryType; description: string }>;
    /** Full bodies for memories in this role's primary types. */
    full: MemoryEntry[];
}

/**
 * Load memories relevant to the given agent role.
 *
 * @param projectRoot - Project root directory
 * @param role - The agent role requesting memories
 */
export function loadMemoriesForRole(projectRoot: string, role: AgentRole): LoadedMemories {
    const relevantTypes = new Set(MEMORY_READ_ROLES[role]);
    const all = loadAll(projectRoot);

    const relevant = all.filter(e => relevantTypes.has(e.type));

    return {
        index: relevant.map(e => ({ name: e.name, type: e.type, description: e.description })),
        full: relevant,
    };
}

/**
 * Format loaded memories as a markdown section for agent system prompts.
 * Injects the full body of each relevant memory.
 */
export function formatMemoriesForAgent(memories: LoadedMemories): string {
    if (memories.full.length === 0) return '';

    const parts: string[] = ['## Project Memory', ''];
    parts.push(
        'The following entries were learned from previous workflow runs on this project.',
        'Use them to avoid rediscovering known patterns and to stay consistent with prior decisions.',
        '',
    );

    for (const entry of memories.full) {
        parts.push(`### [${entry.type}] ${entry.name}`, `> ${entry.description}`, '', entry.body, '');
    }

    return parts.join('\n');
}
