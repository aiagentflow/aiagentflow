/**
 * Diffs to review: from the working tree, the index, a ref range, or a PR.
 *
 * Also parses unified diffs to find which new-side lines can carry a GitHub
 * review comment (GitHub rejects comments on lines outside the diff).
 *
 * Dependency direction: diff.ts → execa
 * Used by: cli/commands/review.ts, integrations/github.ts
 */

import { execa } from 'execa';

/** What to review. */
export type DiffSource =
    | { kind: 'working' }
    | { kind: 'staged' }
    | { kind: 'range'; range: string }
    | { kind: 'pr'; number: number };

export interface ReviewDiff {
    /** Unified diff text. */
    diff: string;
    /** Changed file paths (new side), relative to the repo root. */
    files: string[];
    /** Human description of the source, e.g. "staged changes" or "PR #42". */
    label: string;
    /** PR title and description, when reviewing a PR. */
    title?: string;
    description?: string;
    /** Head commit of the PR, needed to post review comments. */
    headSha?: string;
}

/**
 * Get the diff for `source`.
 * @throws if git or gh fails (not a repo, unknown ref, gh not authenticated)
 */
export async function getDiff(source: DiffSource, cwd: string): Promise<ReviewDiff> {
    switch (source.kind) {
        case 'working':
            return gitDiff(['HEAD'], 'uncommitted changes', cwd);
        case 'staged':
            return gitDiff(['--cached'], 'staged changes', cwd);
        case 'range':
            return gitDiff([source.range], source.range, cwd);
        case 'pr': {
            const { stdout: diff } = await execa('gh', ['pr', 'diff', String(source.number)], { cwd });
            const { stdout: meta } = await execa('gh', ['pr', 'view', String(source.number), '--json', 'title,body,headRefOid'], { cwd });
            const pr = JSON.parse(meta) as { title: string; body?: string; headRefOid: string };
            return {
                diff,
                files: changedFiles(diff),
                label: `PR #${source.number}`,
                title: pr.title,
                description: pr.body ?? '',
                headSha: pr.headRefOid,
            };
        }
    }
}

async function gitDiff(args: string[], label: string, cwd: string): Promise<ReviewDiff> {
    const { stdout: diff } = await execa('git', ['diff', '--no-color', ...args], { cwd });
    return { diff, files: changedFiles(diff), label };
}

/** New-side paths of the files in a unified diff (deleted files excluded). */
export function changedFiles(diff: string): string[] {
    const files: string[] = [];
    // A file header is "--- old" immediately followed by "+++ new"
    for (const match of diff.matchAll(/^--- .*\n\+\+\+ (?:b\/)?(.+)$/gm)) {
        const path = match[1]!.trim();
        if (path !== '/dev/null' && !files.includes(path)) files.push(path);
    }
    return files;
}

/**
 * Lines on the new side of the diff that a review comment may target:
 * added and context lines inside hunks, per file.
 */
export function commentableLines(diff: string): Map<string, Set<number>> {
    const result = new Map<string, Set<number>>();
    let file: string | undefined;
    let line = 0;
    let previous = '';

    for (const raw of diff.split('\n')) {
        const isHeader = raw.startsWith('+++ ') && previous.startsWith('--- ');
        previous = raw;
        if (isHeader) {
            const path = raw.slice(4).replace(/^b\//, '').trim();
            file = path === '/dev/null' ? undefined : path;
            if (file && !result.has(file)) result.set(file, new Set());
            continue;
        }
        const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunk) {
            line = Number(hunk[1]);
            continue;
        }
        if (!file || line === 0 || raw.startsWith('\\')) continue;

        if (raw.startsWith('+') || raw.startsWith(' ')) {
            result.get(file)!.add(line);
            line++;
        }
        // '-' lines exist only on the old side
    }
    return result;
}
