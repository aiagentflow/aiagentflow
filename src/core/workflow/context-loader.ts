/**
 * Context loader — loads reference documents for agent context.
 *
 * Loads documents from explicit paths and auto-discovers files
 * in `.aiagentflow/context/`. These are injected into agent prompts
 * so agents can reference specs, PRDs, architecture docs, etc.
 *
 * Dependency direction: context-loader.ts → config/defaults, utils
 * Used by: workflow runner
 */

import { join, basename, resolve, relative, extname } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { CONFIG_DIR_NAME } from '../config/defaults.js';
import { readTextFile } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';

/** A loaded reference document. */
export interface ContextDocument {
    /** Where the document was loaded from (file path). */
    source: string;
    /** Display name for the document. */
    name: string;
    /** File content. */
    content: string;
}

const CONTEXT_DIR = 'context';

/**
 * Load context documents from explicit paths and auto-discover directory.
 *
 * @param projectRoot - Project root directory
 * @param explicitPaths - Explicit file paths to load (optional)
 * @returns Array of loaded context documents (deduped by resolved path)
 */
export function loadContextDocuments(
    projectRoot: string,
    explicitPaths?: string[],
): ContextDocument[] {
    const seen = new Set<string>();
    const documents: ContextDocument[] = [];

    // Load explicit paths first
    if (explicitPaths) {
        for (const filePath of explicitPaths) {
            const resolved = resolve(projectRoot, filePath);

            if (seen.has(resolved)) continue;
            seen.add(resolved);

            if (!existsSync(resolved)) {
                logger.warn(`Context file not found: ${filePath}`);
                continue;
            }

            try {
                documents.push({
                    source: resolved,
                    name: basename(resolved),
                    content: readTextFile(resolved),
                });
                logger.debug(`Loaded context: ${filePath}`);
            } catch {
                logger.warn(`Failed to read context file: ${filePath}`);
            }
        }
    }

    // Auto-discover from .aiagentflow/context/
    const contextDir = join(projectRoot, CONFIG_DIR_NAME, CONTEXT_DIR);
    if (existsSync(contextDir)) {
        const entries = readdirSync(contextDir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isFile()) continue;
            if (!/\.(md|txt)$/i.test(entry.name)) continue;

            const resolved = join(contextDir, entry.name);

            if (seen.has(resolved)) continue;
            seen.add(resolved);

            try {
                documents.push({
                    source: resolved,
                    name: entry.name,
                    content: readTextFile(resolved),
                });
                logger.debug(`Auto-loaded context: ${entry.name}`);
            } catch {
                logger.warn(`Failed to read context file: ${entry.name}`);
            }
        }
    }

    if (documents.length > 0) {
        logger.info(`Loaded ${documents.length} context document(s)`);
    }

    return documents;
}

/**
 * Format context documents as a markdown section for agent prompts.
 */
export function formatContextForAgent(documents: ContextDocument[]): string {
    if (documents.length === 0) return '';

    const parts: string[] = ['## Reference Documents', ''];

    for (const doc of documents) {
        parts.push(`### ${doc.name}`, '', doc.content, '');
    }

    return parts.join('\n');
}

// ── Source file loading ──

/** Max number of source files to include in context. */
const MAX_SOURCE_FILES = 20;
/** Max size per file in bytes (10KB). */
const MAX_FILE_SIZE = 10 * 1024;
/** Extensions considered binary (skip these). */
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
    '.woff', '.woff2', '.ttf', '.eot',
    '.zip', '.tar', '.gz', '.br',
    '.exe', '.dll', '.so', '.dylib',
    '.mp3', '.mp4', '.wav', '.avi',
    '.pdf', '.doc', '.docx',
]);

/**
 * Load source files matching the configured sourceGlobs patterns.
 * Returns up to MAX_SOURCE_FILES files, each capped at MAX_FILE_SIZE.
 */
export function loadSourceFiles(
    projectRoot: string,
    sourceGlobs: string[],
): ContextDocument[] {
    const documents: ContextDocument[] = [];
    const seen = new Set<string>();

    for (const pattern of sourceGlobs) {
        const matched = expandGlob(projectRoot, pattern);

        for (const filePath of matched) {
            if (documents.length >= MAX_SOURCE_FILES) break;
            if (seen.has(filePath)) continue;
            seen.add(filePath);

            const ext = extname(filePath).toLowerCase();
            if (BINARY_EXTENSIONS.has(ext)) continue;

            try {
                const stat = statSync(filePath);
                if (!stat.isFile() || stat.size > MAX_FILE_SIZE || stat.size === 0) continue;

                const content = readFileSync(filePath, 'utf-8');
                const relPath = relative(projectRoot, filePath);
                documents.push({ source: filePath, name: relPath, content });
            } catch {
                // Skip unreadable files
            }
        }

        if (documents.length >= MAX_SOURCE_FILES) break;
    }

    if (documents.length > 0) {
        logger.debug(`Loaded ${documents.length} source file(s) for context`);
    }

    return documents;
}

/**
 * Format source files as a markdown section for agent prompts.
 */
export function formatSourcesForAgent(documents: ContextDocument[]): string {
    if (documents.length === 0) return '';

    const parts: string[] = ['## Existing Source Files', ''];

    for (const doc of documents) {
        const ext = extname(doc.name).replace('.', '') || 'text';
        parts.push(`### ${doc.name}`, '', `\`\`\`${ext}`, doc.content, '```', '');
    }

    return parts.join('\n');
}

/**
 * Simple glob expansion — supports `**` (recursive), `*` (any chars), and `?` (single char).
 * No external dependency needed for patterns like `src/**\/*.ts`.
 */
function expandGlob(root: string, pattern: string): string[] {
    const results: string[] = [];
    const parts = pattern.split('/');

    function walk(dir: string, partIndex: number): void {
        if (results.length >= MAX_SOURCE_FILES) return;

        if (partIndex >= parts.length) return;

        const part = parts[partIndex]!;
        const isLast = partIndex === parts.length - 1;

        if (part === '**') {
            // Match zero or more directories
            // Try matching remaining pattern at current level
            if (partIndex + 1 < parts.length) {
                walk(dir, partIndex + 1);
            }

            // Recurse into subdirectories
            try {
                const entries = readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                    if (entry.isDirectory()) {
                        walk(join(dir, entry.name), partIndex);
                    }
                }
            } catch {
                // Skip unreadable directories
            }
            return;
        }

        // Convert glob pattern to regex
        const regex = globPartToRegex(part);

        try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.')) continue;
                if (!regex.test(entry.name)) continue;

                const fullPath = join(dir, entry.name);
                if (isLast) {
                    if (entry.isFile()) {
                        results.push(fullPath);
                    }
                } else if (entry.isDirectory()) {
                    walk(fullPath, partIndex + 1);
                }
            }
        } catch {
            // Skip unreadable directories
        }
    }

    walk(root, 0);
    return results.sort();
}

function globPartToRegex(part: string): RegExp {
    const escaped = part
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`);
}
