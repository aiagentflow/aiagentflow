/**
 * GitHub integration — fetch PR comments, issues, and open PRs.
 *
 * Uses the `gh` CLI when available (preferred), falling back to
 * the GitHub REST API via GITHUB_TOKEN if set.
 *
 * Dependency direction: github.ts → execa, node:fs, utils/logger
 * Used by: cli/commands/run.ts
 */

import { execa } from 'execa';
import { logger } from '../utils/logger.js';

export interface PullRequestContext {
    number: number;
    title: string;
    body: string;
    /** Inline review comments from reviewers. */
    reviewComments: ReviewComment[];
    /** Top-level PR review threads. */
    reviews: Review[];
    baseBranch: string;
    headBranch: string;
    repoOwner: string;
    repoName: string;
}

export interface ReviewComment {
    body: string;
    path: string;
    line?: number;
    author: string;
    state?: string;
}

export interface Review {
    body: string;
    state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | string;
    author: string;
}

export interface IssueContext {
    number: number;
    title: string;
    body: string;
    labels: string[];
    assignees: string[];
    repoOwner: string;
    repoName: string;
}

export interface OpenPRResult {
    url: string;
    number: number;
}

/**
 * Fetch a pull request and its review comments.
 * Requires `gh` CLI installed and authenticated.
 */
export async function fetchPR(prNumber: number, repoPath = process.cwd()): Promise<PullRequestContext> {
    await assertGhCli();

    const { stdout: prJson } = await execa(
        'gh', ['pr', 'view', String(prNumber), '--json',
            'number,title,body,baseRefName,headRefName,comments,reviews',
        ],
        { cwd: repoPath },
    );

    const pr = JSON.parse(prJson) as {
        number: number;
        title: string;
        body: string;
        baseRefName: string;
        headRefName: string;
        reviews: Array<{ body: string; state: string; author: { login: string } }>;
    };

    // Fetch inline diff comments (review comments)
    const { stdout: commentsJson } = await execa(
        'gh', ['api', `repos/{owner}/{repo}/pulls/${prNumber}/comments`,
            '--jq', '[.[] | {body, path, line, author: .user.login}]',
        ],
        { cwd: repoPath },
    );

    const reviewComments = JSON.parse(commentsJson) as ReviewComment[];

    // Extract repo info from git remote
    const { repoOwner, repoName } = await getRepoInfo(repoPath);

    return {
        number: pr.number,
        title: pr.title,
        body: pr.body ?? '',
        reviewComments,
        reviews: (pr.reviews ?? []).map(r => ({
            body: r.body,
            state: r.state,
            author: r.author.login,
        })),
        baseBranch: pr.baseRefName,
        headBranch: pr.headRefName,
        repoOwner,
        repoName,
    };
}

/**
 * Fetch a GitHub issue.
 */
export async function fetchIssue(issueNumber: number, repoPath = process.cwd()): Promise<IssueContext> {
    await assertGhCli();

    const { stdout } = await execa(
        'gh', ['issue', 'view', String(issueNumber), '--json',
            'number,title,body,labels,assignees',
        ],
        { cwd: repoPath },
    );

    const issue = JSON.parse(stdout) as {
        number: number;
        title: string;
        body: string;
        labels: Array<{ name: string }>;
        assignees: Array<{ login: string }>;
    };

    const { repoOwner, repoName } = await getRepoInfo(repoPath);

    return {
        number: issue.number,
        title: issue.title,
        body: issue.body ?? '',
        labels: (issue.labels ?? []).map(l => l.name),
        assignees: (issue.assignees ?? []).map(a => a.login),
        repoOwner,
        repoName,
    };
}

/**
 * Open a pull request for the current branch.
 */
export async function openPR(opts: {
    title: string;
    body: string;
    baseBranch?: string;
    repoPath?: string;
}): Promise<OpenPRResult> {
    const { title, body, baseBranch = 'main', repoPath = process.cwd() } = opts;
    await assertGhCli();

    const { stdout } = await execa(
        'gh', ['pr', 'create',
            '--title', title,
            '--body', body,
            '--base', baseBranch,
        ],
        { cwd: repoPath },
    );

    const url = stdout.trim();
    const match = url.match(/\/pull\/(\d+)$/);
    const number = match ? parseInt(match[1]!, 10) : 0;

    logger.success(`PR created: ${url}`);
    return { url, number };
}

/**
 * Build a task string from a PR context (for feeding into the workflow).
 */
export function buildPRTask(ctx: PullRequestContext): string {
    const parts: string[] = [
        `Address review feedback on PR #${ctx.number}: ${ctx.title}`,
        '',
    ];

    if (ctx.body) {
        parts.push('## PR Description', ctx.body, '');
    }

    const requestChanges = ctx.reviews.filter(r => r.state === 'CHANGES_REQUESTED');
    if (requestChanges.length > 0) {
        parts.push('## Review Feedback');
        for (const review of requestChanges) {
            if (review.body) {
                parts.push(`**${review.author}**: ${review.body}`);
            }
        }
        parts.push('');
    }

    if (ctx.reviewComments.length > 0) {
        parts.push('## Inline Comments');
        for (const comment of ctx.reviewComments) {
            const loc = comment.line ? `${comment.path}:${comment.line}` : comment.path;
            parts.push(`**${comment.author}** on \`${loc}\`:\n${comment.body}`);
        }
    }

    return parts.join('\n');
}

/**
 * Build a task string from an issue context.
 */
export function buildIssueTask(ctx: IssueContext): string {
    const parts: string[] = [
        `Implement GitHub issue #${ctx.number}: ${ctx.title}`,
        '',
    ];

    if (ctx.labels.length > 0) {
        parts.push(`Labels: ${ctx.labels.join(', ')}`, '');
    }

    if (ctx.body) {
        parts.push('## Issue Description', ctx.body);
    }

    return parts.join('\n');
}

// ── Helpers ──

async function assertGhCli(): Promise<void> {
    try {
        await execa('gh', ['--version']);
    } catch {
        throw new Error(
            'GitHub CLI (gh) is not installed or not in PATH.\n' +
            'Install from: https://cli.github.com\n' +
            'Then authenticate with: gh auth login',
        );
    }
}

async function getRepoInfo(repoPath: string): Promise<{ repoOwner: string; repoName: string }> {
    try {
        const { stdout } = await execa('gh', ['repo', 'view', '--json', 'owner,name'], { cwd: repoPath });
        const info = JSON.parse(stdout) as { owner: { login: string }; name: string };
        return { repoOwner: info.owner.login, repoName: info.name };
    } catch {
        return { repoOwner: '', repoName: '' };
    }
}
