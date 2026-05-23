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
import { loadConfig, configExists } from '../../core/config/manager.js';
import { logger } from '../../utils/logger.js';

type RunState = 'complete' | 'qa_approved' | 'failed' | 'awaiting_approval' | 'running' | string;

interface RunRow {
    branch: string;
    state: RunState;
    ageMs: number;
    tokens: number;
    costUsd: number;
    session: SessionData | undefined;
}

const STATUS_ICONS: Record<string, string> = {
    qa_approved: '✓',
    complete: '✓',
    failed: '✗',
    plan_pending: '⏸',
    awaiting_approval: '⏸',
};

function statusIcon(state: string): string {
    return STATUS_ICONS[state] ?? '⏵';
}

function stateColor(state: string): (s: string) => string {
    if (state === 'qa_approved' || state === 'complete') return chalk.green;
    if (state === 'failed') return chalk.red;
    if (state === 'plan_pending' || state === 'awaiting_approval') return chalk.blue;
    return chalk.yellow;
}

/** Estimate cost for a session's token usage entries. */
const COST_PER_1M: Record<string, { input: number; output: number }> = {
    'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
    'claude-3-5-haiku-20241022': { input: 1.00, output: 5.00 },
    'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
    'llama3.2:latest': { input: 0, output: 0 },
};

function sessionCost(session: SessionData): number {
    let cost = 0;
    for (const entry of session.tokenUsage ?? []) {
        const pricing = COST_PER_1M[entry.model];
        if (pricing) {
            cost += (entry.promptTokens / 1_000_000) * pricing.input;
            cost += (entry.completionTokens / 1_000_000) * pricing.output;
        }
    }
    return cost;
}

export const runsCommand = new Command('runs')
    .description('List active worktree-based task runs')
    .option('--filter <state>', 'Filter by state (running, complete, failed, waiting)')
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
            const state = session?.context.state ?? 'unknown';
            const tokens = session?.tokenUsage?.reduce((s, e) => s + e.totalTokens, 0) ?? 0;
            return {
                branch: wt.branch,
                state,
                ageMs: session ? Date.now() - session.createdAt : 0,
                tokens,
                costUsd: session ? sessionCost(session) : 0,
                session,
            };
        });

        // Apply --filter
        if (opts.filter) {
            const f = opts.filter.toLowerCase();
            rows = rows.filter(r => {
                const s = r.state.toLowerCase();
                if (f === 'complete') return s === 'qa_approved' || s === 'complete';
                if (f === 'failed') return s === 'failed';
                if (f === 'waiting') return s === 'plan_pending' || s === 'awaiting_approval';
                if (f === 'running') return s !== 'qa_approved' && s !== 'complete' && s !== 'failed';
                return s.includes(f);
            });
        }

        // JSON output
        if (opts.json) {
            console.log(JSON.stringify(rows.map(r => ({
                branch: r.branch,
                state: r.state,
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
        const header = ['', 'Branch', 'State', 'Age', 'Tokens', 'Cost'];
        const widths = [3, 40, 22, 8, 10, 10];
        console.log(chalk.gray('  ' + header.map((h, i) => h.padEnd(widths[i]!)).join('')));
        console.log(chalk.gray('  ' + '─'.repeat(93)));

        for (const row of rows) {
            const icon = stateColor(row.state)(statusIcon(row.state));
            const branch = chalk.cyan(row.branch.slice(0, 38).padEnd(widths[1]!));
            const state = stateColor(row.state)(row.state.padEnd(widths[2]!));
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
