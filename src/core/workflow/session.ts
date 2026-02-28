/**
 * Session persistence — save and resume workflow state.
 *
 * Saves the workflow context to `.aiagentflow/sessions/` so workflows
 * can survive crashes, restarts, and be resumed later.
 *
 * Dependency direction: session.ts → utils/fs, core/errors
 * Used by: workflow runner
 */

import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { CONFIG_DIR_NAME } from '../config/defaults.js';
import { ensureDir, readTextFile, writeJsonFile } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';
import type { WorkflowContext } from './engine.js';
import type { TokenUsageEntry } from './token-tracker.js';

const SESSIONS_DIR = 'sessions';

/** Persisted session data. */
export interface SessionData {
    /** Unique session ID. */
    id: string;
    /** When the session was created. */
    createdAt: number;
    /** When the session was last updated. */
    updatedAt: number;
    /** The workflow context snapshot. */
    context: WorkflowContext;
    /** Token usage entries. */
    tokenUsage: TokenUsageEntry[];
}

/**
 * Get the sessions directory path.
 */
function getSessionsDir(projectRoot: string): string {
    return join(projectRoot, CONFIG_DIR_NAME, SESSIONS_DIR);
}

/**
 * Generate a short session ID from the task description.
 */
function generateSessionId(task: string): string {
    const timestamp = Date.now().toString(36);
    const slug = task
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 30);
    return `${slug}-${timestamp}`;
}

/**
 * Save a workflow session to disk.
 */
export function saveSession(
    projectRoot: string,
    context: WorkflowContext,
    tokenUsage: TokenUsageEntry[] = [],
    sessionId?: string,
): string {
    const sessionsDir = getSessionsDir(projectRoot);
    ensureDir(sessionsDir);

    const id = sessionId ?? generateSessionId(context.task);
    const sessionPath = join(sessionsDir, `${id}.json`);

    const data: SessionData = {
        id,
        createdAt: existsSync(sessionPath)
            ? loadSession(projectRoot, id)?.createdAt ?? Date.now()
            : Date.now(),
        updatedAt: Date.now(),
        context,
        tokenUsage,
    };

    writeJsonFile(sessionPath, data);
    logger.debug(`Session saved: ${id}`);

    return id;
}

/**
 * Load a workflow session from disk.
 */
export function loadSession(projectRoot: string, sessionId: string): SessionData | null {
    const sessionPath = join(getSessionsDir(projectRoot), `${sessionId}.json`);

    if (!existsSync(sessionPath)) {
        return null;
    }

    try {
        const content = readTextFile(sessionPath);
        return JSON.parse(content) as SessionData;
    } catch {
        logger.warn(`Failed to load session: ${sessionId}`);
        return null;
    }
}

/**
 * List all saved sessions for a project.
 */
export function listSessions(projectRoot: string): SessionData[] {
    const sessionsDir = getSessionsDir(projectRoot);

    if (!existsSync(sessionsDir)) {
        return [];
    }

    const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    const sessions: SessionData[] = [];

    for (const file of files) {
        try {
            const content = readTextFile(join(sessionsDir, file));
            sessions.push(JSON.parse(content) as SessionData);
        } catch {
            // Skip corrupted session files
        }
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}
