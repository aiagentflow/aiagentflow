/**
 * Tests for GitHub integration task builders.
 */

import { describe, it, expect } from 'vitest';
import { buildPRTask, buildIssueTask } from '../../src/integrations/github.js';
import type { PullRequestContext, IssueContext } from '../../src/integrations/github.js';

const prCtx: PullRequestContext = {
    number: 42,
    title: 'Add OAuth2 support',
    body: 'This PR adds OAuth2 login.',
    reviewComments: [
        { body: 'Please add error handling here', path: 'src/auth.ts', line: 42, author: 'alice' },
    ],
    reviews: [
        { body: 'Logic looks off in the token refresh path', state: 'CHANGES_REQUESTED', author: 'bob' },
    ],
    baseBranch: 'main',
    headBranch: 'feat/oauth',
    repoOwner: 'acme',
    repoName: 'app',
};

const issueCtx: IssueContext = {
    number: 7,
    title: 'Support dark mode',
    body: 'Users want a dark mode option in settings.',
    labels: ['enhancement', 'ui'],
    assignees: ['carol'],
    repoOwner: 'acme',
    repoName: 'app',
};

describe('buildPRTask', () => {
    it('includes PR number and title', () => {
        const task = buildPRTask(prCtx);
        expect(task).toContain('#42');
        expect(task).toContain('Add OAuth2 support');
    });

    it('includes changes-requested review body', () => {
        const task = buildPRTask(prCtx);
        expect(task).toContain('token refresh path');
        expect(task).toContain('bob');
    });

    it('includes inline comment with file path', () => {
        const task = buildPRTask(prCtx);
        expect(task).toContain('src/auth.ts');
        expect(task).toContain('error handling');
    });

    it('includes PR description', () => {
        const task = buildPRTask(prCtx);
        expect(task).toContain('adds OAuth2 login');
    });
});

describe('buildIssueTask', () => {
    it('includes issue number and title', () => {
        const task = buildIssueTask(issueCtx);
        expect(task).toContain('#7');
        expect(task).toContain('Support dark mode');
    });

    it('includes labels', () => {
        const task = buildIssueTask(issueCtx);
        expect(task).toContain('enhancement');
        expect(task).toContain('ui');
    });

    it('includes issue body', () => {
        const task = buildIssueTask(issueCtx);
        expect(task).toContain('dark mode option in settings');
    });

    it('skips labels section when there are none', () => {
        const noLabels: IssueContext = { ...issueCtx, labels: [] };
        const task = buildIssueTask(noLabels);
        expect(task).not.toContain('Labels:');
    });
});
