/**
 * Agent memory type definitions.
 *
 * Memories are per-project markdown files stored in .aiagentflow/memory/.
 * Agents write them during workflow runs; they are injected into future
 * agent prompts to carry forward learned conventions and decisions.
 *
 * Dependency direction: memory/types.ts → zod (leaf module)
 * Used by: memory/store.ts, memory/loader.ts, memory/tool.ts
 */

import { z } from 'zod';
import type { AgentRole } from '../agents/types.js';

/** Categories of memory that agents can write. */
export type MemoryType = 'architecture' | 'convention' | 'decision' | 'gotcha' | 'reference';

export const MEMORY_TYPES: readonly MemoryType[] = [
    'architecture',
    'convention',
    'decision',
    'gotcha',
    'reference',
] as const;

/** Which agent roles may write each memory type. */
export const MEMORY_WRITE_ROLES: Record<MemoryType, readonly AgentRole[]> = {
    architecture: ['architect'],
    convention: ['reviewer', 'architect'],
    decision: ['architect', 'judge'],
    gotcha: ['fixer', 'tester', 'reviewer'],
    reference: ['architect', 'coder'],
};

/** Which memory types are injected per agent role. */
export const MEMORY_READ_ROLES: Record<AgentRole, readonly MemoryType[]> = {
    architect: ['architecture', 'decision', 'reference', 'convention'],
    coder: ['architecture', 'convention', 'reference'],
    reviewer: ['convention', 'gotcha', 'architecture'],
    security: ['convention', 'gotcha'],
    tester: ['gotcha', 'architecture', 'reference'],
    fixer: ['gotcha', 'convention', 'architecture'],
    judge: ['decision', 'convention', 'architecture'],
};

/** Human-readable label per type. */
export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
    architecture: 'Architecture',
    convention: 'Convention',
    decision: 'Decision',
    gotcha: 'Gotcha',
    reference: 'Reference',
};

/** Zod schema for the YAML-like frontmatter in memory files. */
export const memoryFrontmatterSchema = z.object({
    name: z.string().min(1).max(80),
    type: z.enum(['architecture', 'convention', 'decision', 'gotcha', 'reference']),
    description: z.string().min(1).max(200),
    created: z.string(),
    updated: z.string(),
});

export type MemoryFrontmatter = z.infer<typeof memoryFrontmatterSchema>;

/** A fully parsed memory entry. */
export interface MemoryEntry {
    /** Unique slug (kebab-case filename without .md). */
    name: string;
    type: MemoryType;
    /** One-line summary for the memory index injected in prompts. */
    description: string;
    /** ISO timestamp when first created. */
    created: string;
    /** ISO timestamp of most recent update. */
    updated: string;
    /** Full markdown body. */
    body: string;
    /** Absolute path of the backing file. */
    filePath: string;
}

/** Max body size in characters — prevents token bloat. */
export const MAX_MEMORY_BODY_CHARS = 4000;

/** Max number of memories per type before LRU eviction. */
export const MAX_MEMORIES_PER_TYPE = 50;

/** Days without access before gc evicts a memory. */
export const MEMORY_GC_STALE_DAYS = 30;
