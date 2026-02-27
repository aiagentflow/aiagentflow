/**
 * Git client — wraps simple-git for branch, commit, and diff operations.
 *
 * Dependency direction: client.ts → simple-git, core/errors, utils
 * Used by: workflow runner
 */

import { simpleGit, type SimpleGit } from 'simple-git';
import { GitError } from '../core/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Git client for workflow operations.
 */
export class GitClient {
    private readonly git: SimpleGit;
    private readonly projectRoot: string;

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
        this.git = simpleGit(projectRoot);
    }

    /**
     * Check if the project is a Git repository.
     */
    async isRepo(): Promise<boolean> {
        try {
            return await this.git.checkIsRepo();
        } catch {
            return false;
        }
    }

    /**
     * Get the current branch name.
     */
    async getCurrentBranch(): Promise<string> {
        try {
            const status = await this.git.status();
            return status.current ?? 'main';
        } catch (err) {
            throw new GitError(
                `Failed to get current branch: ${err instanceof Error ? err.message : String(err)}`,
                { projectRoot: this.projectRoot },
            );
        }
    }

    /**
     * Create and switch to a new branch for the workflow task.
     */
    async createBranch(branchName: string): Promise<void> {
        try {
            await this.git.checkoutLocalBranch(branchName);
            logger.info(`Created and switched to branch: ${branchName}`);
        } catch (err) {
            throw new GitError(
                `Failed to create branch "${branchName}": ${err instanceof Error ? err.message : String(err)}`,
                { branch: branchName },
            );
        }
    }

    /**
     * Stage all changes and commit.
     */
    async commitAll(message: string): Promise<string> {
        try {
            await this.git.add('.');
            const result = await this.git.commit(message);
            const hash = result.commit || 'unknown';
            logger.info(`Committed: ${hash} — ${message}`);
            return hash;
        } catch (err) {
            throw new GitError(
                `Failed to commit: ${err instanceof Error ? err.message : String(err)}`,
                { message },
            );
        }
    }

    /**
     * Get a summary of changed files.
     */
    async getStatus(): Promise<{ staged: string[]; modified: string[]; untracked: string[] }> {
        try {
            const status = await this.git.status();
            return {
                staged: status.staged,
                modified: status.modified,
                untracked: status.not_added,
            };
        } catch (err) {
            throw new GitError(
                `Failed to get git status: ${err instanceof Error ? err.message : String(err)}`,
                { projectRoot: this.projectRoot },
            );
        }
    }

    /**
     * Get the diff of current changes.
     */
    async getDiff(): Promise<string> {
        try {
            return await this.git.diff();
        } catch (err) {
            throw new GitError(
                `Failed to get diff: ${err instanceof Error ? err.message : String(err)}`,
                { projectRoot: this.projectRoot },
            );
        }
    }

    /**
     * Generate a safe branch name from a task description.
     */
    static toBranchName(prefix: string, task: string): string {
        const slug = task
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 50);
        return `${prefix}${slug}`;
    }
}
