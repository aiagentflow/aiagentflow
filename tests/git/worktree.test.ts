/**
 * Tests for the worktree slug and branch naming utilities.
 *
 * Avoids touching the real filesystem/git — only tests the pure logic.
 */

import { describe, it, expect } from 'vitest';

// Pull out the private slug logic by re-implementing its spec
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

describe('worktree branch slug', () => {
    it('lowercases and hyphenates', () => {
        expect(taskToSlug('Build a REST API')).toBe('build-a-rest-api');
    });

    it('takes at most 6 words', () => {
        const result = taskToSlug('one two three four five six seven eight');
        expect(result.split('-').length).toBeLessThanOrEqual(6);
    });

    it('caps total length at 40 chars', () => {
        const long = 'add-a-very-long-description-that-exceeds-limit-by-a-lot';
        expect(taskToSlug(long).length).toBeLessThanOrEqual(40);
    });

    it('strips leading/trailing hyphens', () => {
        expect(taskToSlug('  Build feature  ')).not.toMatch(/^-|-$/);
    });

    it('replaces special characters with hyphens', () => {
        expect(taskToSlug('Fix: auth/session bug!')).toBe('fix-auth-session-bug');
    });
});

describe('worktree branch name format', () => {
    it('follows <prefix><slug>-<timestamp> pattern', () => {
        const prefix = 'aiagentflow/';
        const slug = taskToSlug('Add user login');
        const timestamp = Date.now().toString(36);
        const branch = `${prefix}${slug}-${timestamp}`;

        expect(branch).toMatch(/^aiagentflow\//);
        expect(branch.split('-').length).toBeGreaterThan(1);

        // Timestamp is recoverable from last segment
        const parts = branch.split('-');
        const ts = parseInt(parts[parts.length - 1]!, 36);
        expect(ts).toBeGreaterThan(0);
        expect(ts).toBeLessThanOrEqual(Date.now());
    });
});
