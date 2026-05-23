/**
 * Git worktree management — create and manage isolated task worktrees.
 *
 * Each workflow run optionally gets its own git worktree on a fresh branch,
 * so agents never touch the user's live working directory.
 *
 * Dependency direction: worktree.ts → execa, node:fs, utils/logger
 * Used by: workflow runner
 */

import { execa } from 'execa';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';

/** Information about a created worktree. */
export interface WorktreeInfo {
    /** Absolute path to the worktree directory. */
    path: string;
    /** The branch created for this worktree. */
    branch: string;
    /** The branch that was checked out when the worktree was created. */
    baseBranch: string;
    /** Remove the worktree and delete its branch. */
    cleanup: () => Promise<void>;
}

/** A worktree entry from `git worktree list`. */
export interface WorktreeEntry {
    path: string;
    branch: string;
    head: string;
}

/**
 * Create a git worktree for an isolated task run.
 *
 * Branch name: `<branchPrefix><slug>-<base36-timestamp>`
 * Worktree path: `<projectRoot>/.aiagentflow/worktrees/<branch-slug>`
 */
export async function createWorktree(opts: {
    projectRoot: string;
    branchPrefix: string;
    task: string;
    baseRef?: string;
}): Promise<WorktreeInfo> {
    const { projectRoot, branchPrefix, task, baseRef = 'HEAD' } = opts;

    const timestamp = Date.now().toString(36);
    const slug = taskToSlug(task);
    const branch = `${branchPrefix}${slug}-${timestamp}`;
    const safeDir = branch.replace(/\//g, '_');
    const worktreePath = join(projectRoot, '.aiagentflow', 'worktrees', safeDir);

    const baseBranch = await getCurrentBranch(projectRoot);

    await execa('git', ['worktree', 'add', '-b', branch, worktreePath, baseRef], { cwd: projectRoot });
    logger.info(`Worktree created: ${worktreePath} (branch: ${branch})`);

    return {
        path: worktreePath,
        branch,
        baseBranch,
        cleanup: () => removeWorktree(projectRoot, worktreePath, branch),
    };
}

/**
 * Remove a worktree directory and delete its branch.
 */
export async function removeWorktree(
    projectRoot: string,
    worktreePath: string,
    branch: string,
): Promise<void> {
    try {
        if (existsSync(worktreePath)) {
            await execa('git', ['worktree', 'remove', '--force', worktreePath], { cwd: projectRoot });
        }
    } catch (err) {
        logger.warn(`git worktree remove failed: ${err instanceof Error ? err.message : String(err)}`);
        if (existsSync(worktreePath)) {
            rmSync(worktreePath, { recursive: true, force: true });
            // Prune the stale worktree reference
            await execa('git', ['worktree', 'prune'], { cwd: projectRoot }).catch(() => undefined);
        }
    }

    try {
        await execa('git', ['branch', '-D', branch], { cwd: projectRoot });
    } catch {
        // Branch may already be merged or deleted
    }
}

/**
 * List all aiagentflow worktrees (excludes main worktree).
 */
export async function listWorktrees(
    projectRoot: string,
    branchPrefix: string,
): Promise<WorktreeEntry[]> {
    try {
        const { stdout } = await execa('git', ['worktree', 'list', '--porcelain'], { cwd: projectRoot });
        const entries: WorktreeEntry[] = [];

        for (const block of stdout.trim().split('\n\n')) {
            const lines = block.split('\n');
            const path = lines.find(l => l.startsWith('worktree '))?.slice(9) ?? '';
            const head = lines.find(l => l.startsWith('HEAD '))?.slice(5) ?? '';
            const branch = lines.find(l => l.startsWith('branch '))?.slice(7).replace('refs/heads/', '') ?? '';

            if (path === projectRoot) continue;
            if (!branch.startsWith(branchPrefix)) continue;

            entries.push({ path, branch, head });
        }

        return entries;
    } catch {
        return [];
    }
}

/**
 * Merge a worktree branch into the current branch (no-ff).
 */
export async function mergeBranch(projectRoot: string, branch: string): Promise<void> {
    await execa('git', ['merge', '--no-ff', branch, '-m', `Merge ${branch}`], { cwd: projectRoot });
}

/**
 * Remove worktrees older than maxAgeMs.
 * Returns number of pruned worktrees.
 */
export async function pruneStaleWorktrees(
    projectRoot: string,
    branchPrefix: string,
    maxAgeMs: number,
): Promise<number> {
    const worktrees = await listWorktrees(projectRoot, branchPrefix);
    let pruned = 0;

    for (const wt of worktrees) {
        const parts = wt.branch.split('-');
        const tsBase36 = parts[parts.length - 1];
        if (!tsBase36) continue;

        const ts = parseInt(tsBase36, 36);
        if (isNaN(ts)) continue;

        if (Date.now() - ts > maxAgeMs) {
            await removeWorktree(projectRoot, wt.path, wt.branch);
            pruned++;
        }
    }

    return pruned;
}

/**
 * Check whether a worktree directory still exists and is registered with git.
 */
export async function worktreeExists(projectRoot: string, worktreePath: string): Promise<boolean> {
    if (!existsSync(worktreePath)) return false;
    try {
        const { stdout } = await execa('git', ['worktree', 'list', '--porcelain'], { cwd: projectRoot });
        return stdout.includes(`worktree ${worktreePath}`);
    } catch {
        return false;
    }
}

// ── Helpers ──

async function getCurrentBranch(projectRoot: string): Promise<string> {
    try {
        const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectRoot });
        return stdout.trim();
    } catch {
        return 'main';
    }
}

function taskToSlug(task: string): string {
    return task
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .split('-')
        .slice(0, 6)
        .join('-')
        .slice(0, 40);
}
