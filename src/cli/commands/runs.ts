/**
 * `aiagentflow runs` — list active worktree-based task runs.
 *
 * Shows all worktrees created by aiagentflow, their branch names,
 * session state, age, and token/cost totals. Pairs with `discard` and `gc`.
 *
 * Dependency direction: runs.ts → commander, git/worktree, workflow/session, config
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { listWorktrees } from '../../git/worktree.js';
import { listSessions, type SessionData } from '../../core/workflow/session.js';
import { runLabel, type RunStatus } from '../../core/workflow/engine.js';
import { loadConfig, configExists } from '../../core/config/manager.js';
import { logger } from '../../utils/logger.js';
import { costOf } from '../../core/workflow/token-tracker.js';

interface RunRow {
    branch: string;
    /** passed, failed, running, or unknown (no session). */
    status: RunStatus | 'unknown';
    /** Display label, e.g. "at review". */
    label: string;
    ageMs: number;
    tokens: number;
    costUsd: number;
    session: SessionData | undefined;
}

const STATUS_ICONS: Record<RunRow['status'], string> = {
    passed: '✓',
    failed: '✗',
    running: '⏵',
    unknown: '?',
};

function statusColor(status: RunRow['status']): (s: string) => string {
    if (status === 'passed') return chalk.green;
    if (status === 'failed') return chalk.red;
    return chalk.yellow;
}

/** Estimated USD cost of a session's token usage. */
function sessionCost(session: SessionData): number {
    return (session.tokenUsage ?? []).reduce((sum, entry) => sum + costOf(entry), 0);
}

export const runsCommand = new Command('runs')
    .description('List active worktree-based task runs')
    .option('--filter <status>', 'Filter by status (running, passed, failed)')
    .option('--json', 'Output as JSON')
    .action(async (opts: { filter?: string; json?: boolean }) => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exit(1);
        }

        const config = loadConfig(projectRoot);
        const worktrees = await listWorktrees(projectRoot, config.workflow.branchPrefix);

        const sessions = listSessions(projectRoot);
        const sessionByBranch = new Map(
            sessions
                .filter(s => s.worktreeBranch)
                .map(s => [s.worktreeBranch!, s]),
        );

        let rows: RunRow[] = worktrees.map(wt => {
            const session = sessionByBranch.get(wt.branch);
            const tokens = session?.tokenUsage?.reduce((s, e) => s + e.totalTokens, 0) ?? 0;
            return {
                branch: wt.branch,
                status: session?.context.status ?? 'unknown',
                label: session ? runLabel(session.context) : 'unknown',
                ageMs: session ? Date.now() - session.createdAt : 0,
                tokens,
                costUsd: session ? sessionCost(session) : 0,
                session,
            };
        });

        // Apply --filter
        if (opts.filter) {
            const f = opts.filter.toLowerCase();
            // "complete" is kept as an alias of "passed" for v1 scripts
            const wanted = f === 'complete' ? 'passed' : f;
            rows = rows.filter(r => r.status === wanted);
        }

        // JSON output
        if (opts.json) {
            console.log(JSON.stringify(rows.map(r => ({
                branch: r.branch,
                status: r.status,
                step: r.session?.context.step ?? null,
                ageSec: Math.floor(r.ageMs / 1000),
                tokens: r.tokens,
                costUsd: parseFloat(r.costUsd.toFixed(6)),
                sessionId: r.session?.id,
            })), null, 2));
            return;
        }

        if (rows.length === 0) {
            if (opts.filter) {
                console.log(chalk.gray(`No runs matching --filter ${opts.filter}.`));
            } else {
                console.log(chalk.gray('No active worktree runs found.'));
                console.log(chalk.gray('Start one with: aiagentflow run --isolate "your task"'));
            }
            return;
        }

        console.log(chalk.bold(`\n  ${rows.length} run(s)\n`));
        const header = ['', 'Branch', 'Status', 'Age', 'Tokens', 'Cost'];
        const widths = [3, 40, 22, 8, 10, 10];
        console.log(chalk.gray('  ' + header.map((h, i) => h.padEnd(widths[i]!)).join('')));
        console.log(chalk.gray('  ' + '─'.repeat(93)));

        for (const row of rows) {
            const icon = statusColor(row.status)(STATUS_ICONS[row.status]);
            const branch = chalk.cyan(row.branch.slice(0, 38).padEnd(widths[1]!));
            const state = statusColor(row.status)(row.label.padEnd(widths[2]!));
            const age = chalk.gray(formatAge(row.ageMs).padEnd(widths[3]!));
            const tokens = chalk.gray((row.tokens > 0 ? row.tokens.toLocaleString() : '—').padEnd(widths[4]!));
            const cost = chalk.gray(row.costUsd > 0 ? `$${row.costUsd.toFixed(4)}` : '—');
            console.log(`  ${icon.padEnd(widths[0]!)} ${branch}${state}${age}${tokens}${cost}`);
        }

        console.log();
        console.log(chalk.gray('  To merge a run:    aiagentflow discard --merge <branch>'));
        console.log(chalk.gray('  To discard a run:  aiagentflow discard <branch>'));
        console.log(chalk.gray('  To prune old runs: aiagentflow gc'));
        console.log();
    });

function formatAge(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}
