/**
 * Memory store — file I/O for agent memory entries.
 *
 * Each memory is stored as a markdown file with a simple frontmatter header:
 *   ---
 *   name: my-memory-slug
 *   type: architecture
 *   description: One-line summary used in the memory index
 *   created: 2026-05-24T00:00:00.000Z
 *   updated: 2026-05-24T00:00:00.000Z
 *   ---
 *   Full markdown body here…
 *
 * Dependency direction: memory/store.ts → memory/types.ts, node:fs, utils
 * Used by: memory/loader.ts, memory/tool.ts, cli/commands/memory.ts
 */

import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { CONFIG_DIR_NAME } from '../core/config/defaults.js';
import { logger } from '../utils/logger.js';
import {
    memoryFrontmatterSchema,
    MEMORY_GC_STALE_DAYS,
    MAX_MEMORIES_PER_TYPE,
    type MemoryEntry,
    type MemoryType,
    type MemoryFrontmatter,
} from './types.js';

const MEMORY_DIR = 'memory';

/** Resolve the absolute path to the memory directory. */
export function getMemoryDir(projectRoot: string): string {
    return join(projectRoot, CONFIG_DIR_NAME, MEMORY_DIR);
}

/** Ensure the memory directory exists. */
function ensureMemoryDir(projectRoot: string): string {
    const dir = getMemoryDir(projectRoot);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/** Convert a memory name to a safe filename slug. */
export function nameToSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
}

/**
 * Serialize a memory entry to file content (frontmatter + body).
 */
function serialize(entry: Omit<MemoryEntry, 'filePath'>): string {
    const fm = [
        '---',
        `name: ${entry.name}`,
        `type: ${entry.type}`,
        `description: ${entry.description}`,
        `created: ${entry.created}`,
        `updated: ${entry.updated}`,
        '---',
        '',
        entry.body,
    ].join('\n');
    return fm;
}

/**
 * Parse a memory file into a MemoryEntry.
 * Returns null if the file has invalid frontmatter.
 */
export function parseMemoryFile(filePath: string): MemoryEntry | null {
    let raw: string;
    try {
        raw = readFileSync(filePath, 'utf-8');
    } catch {
        return null;
    }

    if (!raw.startsWith('---')) return null;

    const endIdx = raw.indexOf('\n---', 3);
    if (endIdx === -1) return null;

    const fmRaw = raw.slice(4, endIdx).trim();
    const body = raw.slice(endIdx + 4).trimStart();

    // Parse simple key: value frontmatter (no YAML dep needed)
    const fm: Record<string, string> = {};
    for (const line of fmRaw.split('\n')) {
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const key = line.slice(0, colon).trim();
        const val = line.slice(colon + 1).trim();
        fm[key] = val;
    }

    const result = memoryFrontmatterSchema.safeParse(fm);
    if (!result.success) {
        logger.debug(`Skipping invalid memory file: ${filePath}`);
        return null;
    }

    const { name, type, description, created, updated } = result.data as MemoryFrontmatter;
    return { name, type, description, created, updated, body, filePath };
}

/**
 * Load all memory entries from the project's memory directory.
 * Skips files with invalid frontmatter silently.
 */
export function loadAll(projectRoot: string): MemoryEntry[] {
    const dir = getMemoryDir(projectRoot);
    if (!existsSync(dir)) return [];

    const entries: MemoryEntry[] = [];
    let files: string[];
    try {
        files = readdirSync(dir).filter(f => f.endsWith('.md'));
    } catch {
        return [];
    }

    for (const file of files) {
        const parsed = parseMemoryFile(join(dir, file));
        if (parsed) entries.push(parsed);
    }

    return entries;
}

/**
 * Save a memory entry, creating or updating the backing file.
 * Runs LRU eviction if the type bucket is over the cap.
 */
export function save(
    projectRoot: string,
    entry: Omit<MemoryEntry, 'filePath' | 'created' | 'updated'> & { created?: string },
): MemoryEntry {
    const dir = ensureMemoryDir(projectRoot);
    const slug = nameToSlug(entry.name);
    const filePath = join(dir, `${slug}.md`);
    const now = new Date().toISOString();

    // Preserve original created timestamp if updating
    let created = entry.created ?? now;
    const existing = parseMemoryFile(filePath);
    if (existing) {
        created = existing.created;
    }

    const full: MemoryEntry = {
        ...entry,
        name: slug,
        created,
        updated: now,
        filePath,
    };

    writeFileSync(filePath, serialize(full), 'utf-8');
    logger.debug(`Memory saved: ${slug} (${entry.type})`);

    evictLRU(projectRoot, entry.type);

    return full;
}

/**
 * Delete a memory by name/slug.
 * Returns true if deleted, false if not found.
 */
export function deleteMemory(projectRoot: string, name: string): boolean {
    const dir = getMemoryDir(projectRoot);
    const slug = nameToSlug(name);
    const filePath = join(dir, `${slug}.md`);

    if (!existsSync(filePath)) return false;
    rmSync(filePath);
    return true;
}

/**
 * Evict the least-recently-updated memories when a type bucket exceeds MAX_MEMORIES_PER_TYPE.
 */
function evictLRU(projectRoot: string, type: MemoryType): void {
    const all = loadAll(projectRoot).filter(e => e.type === type);
    if (all.length <= MAX_MEMORIES_PER_TYPE) return;

    const sorted = [...all].sort(
        (a, b) => new Date(a.updated).getTime() - new Date(b.updated).getTime(),
    );
    const toEvict = sorted.slice(0, all.length - MAX_MEMORIES_PER_TYPE);

    for (const entry of toEvict) {
        rmSync(entry.filePath);
        logger.debug(`Evicted stale memory: ${entry.name}`);
    }
}

/**
 * Evict memories not updated in MEMORY_GC_STALE_DAYS days.
 * Called by `aiagentflow gc`.
 */
export function evictStaleMemories(projectRoot: string): number {
    const cutoffMs = MEMORY_GC_STALE_DAYS * 24 * 60 * 60 * 1000;
    const all = loadAll(projectRoot);
    let count = 0;

    for (const entry of all) {
        const ageMs = Date.now() - new Date(entry.updated).getTime();
        if (ageMs > cutoffMs) {
            rmSync(entry.filePath);
            count++;
        }
    }

    return count;
}
