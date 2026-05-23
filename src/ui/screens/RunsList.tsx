/**
 * TUI RunsList screen — shows active worktree runs with live status.
 *
 * Renders a table of runs: status icon, branch, state, age, token count.
 * Auto-refreshes every 2 seconds.
 *
 * Dependency direction: RunsList.tsx → ink, workflow/session, git/worktree, config
 * Used by: ui/App.tsx
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { listWorktrees, type WorktreeEntry } from '../../git/worktree.js';
import { listSessions, type SessionData } from '../../core/workflow/session.js';
import { loadConfig, configExists } from '../../core/config/manager.js';

interface RunRow {
    worktree: WorktreeEntry;
    session: SessionData | undefined;
    ageMs: number;
    tokens: number;
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

type ColorName = 'green' | 'red' | 'blue' | 'yellow' | 'gray';

function statusColor(state: string): ColorName {
    if (state === 'qa_approved' || state === 'complete') return 'green';
    if (state === 'failed') return 'red';
    if (state === 'plan_pending' || state === 'awaiting_approval') return 'blue';
    return 'yellow';
}

function formatAge(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h`;
}

interface Props {
    projectRoot: string;
}

export function RunsList({ projectRoot }: Props): React.JSX.Element {
    const [rows, setRows] = useState<RunRow[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function refresh() {
            if (!configExists(projectRoot)) {
                setError('No configuration found. Run "aiagentflow init" first.');
                return;
            }

            try {
                const config = loadConfig(projectRoot);
                const worktrees = await listWorktrees(projectRoot, config.workflow.branchPrefix);
                const sessions = listSessions(projectRoot);
                const sessionByBranch = new Map(
                    sessions.filter(s => s.worktreeBranch).map(s => [s.worktreeBranch!, s]),
                );

                if (!cancelled) {
                    setRows(worktrees.map(wt => {
                        const session = sessionByBranch.get(wt.branch);
                        return {
                            worktree: wt,
                            session,
                            ageMs: session ? Date.now() - session.createdAt : 0,
                            tokens: session?.tokenUsage?.reduce((s, e) => s + e.totalTokens, 0) ?? 0,
                        };
                    }));
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : String(err));
            }
        }

        refresh();
        const interval = setInterval(refresh, 2000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [projectRoot]);

    if (error) {
        return <Text color="red">{error}</Text>;
    }

    if (rows.length === 0) {
        return (
            <Box flexDirection="column" paddingLeft={2}>
                <Text color="gray">No active worktree runs.</Text>
                <Text color="gray">Start one: aiagentflow run --isolate "your task"</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column">
            <Box paddingLeft={2} marginBottom={1}>
                <Text bold>{rows.length} active run(s)</Text>
            </Box>

            {/* Header */}
            <Box paddingLeft={2}>
                <Text color="gray">{''.padEnd(3)}</Text>
                <Text color="gray">{'Branch'.padEnd(42)}</Text>
                <Text color="gray">{'State'.padEnd(22)}</Text>
                <Text color="gray">{'Age'.padEnd(8)}</Text>
                <Text color="gray">Tokens</Text>
            </Box>
            <Box paddingLeft={2}>
                <Text color="gray">{'─'.repeat(85)}</Text>
            </Box>

            {rows.map(row => {
                const state = row.session?.context.state ?? 'unknown';
                const color = statusColor(state);
                const icon = statusIcon(state);
                const branch = row.worktree.branch.slice(0, 40).padEnd(42);
                const statePadded = state.padEnd(22);
                const age = formatAge(row.ageMs).padEnd(8);
                const tokStr = row.tokens > 0 ? row.tokens.toLocaleString() : '—';

                return (
                    <Box key={row.worktree.branch} paddingLeft={2}>
                        <Text color={color}>{`${icon}  `}</Text>
                        <Text color="cyan">{branch}</Text>
                        <Text color={color}>{statePadded}</Text>
                        <Text color="gray">{age}</Text>
                        <Text color="gray">{tokStr}</Text>
                    </Box>
                );
            })}

            <Box paddingLeft={2} marginTop={1}>
                <Text color="gray">Press </Text>
                <Text color="white">q</Text>
                <Text color="gray"> to quit · </Text>
                <Text color="white">r</Text>
                <Text color="gray"> to refresh</Text>
            </Box>
        </Box>
    );
}
