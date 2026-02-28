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

import { join, basename, resolve } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
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
