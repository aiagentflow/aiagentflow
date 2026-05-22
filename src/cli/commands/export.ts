/**
 * `aiagentflow export` — Export a workflow session as a structured report.
 *
 * Generates markdown or JSON reports from saved sessions — useful for
 * PR descriptions, audit trails, and CI artifact uploads.
 *
 * Dependency direction: export.ts → commander, session, token-tracker
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { configExists } from '../../core/config/manager.js';
import { listSessions, loadSession } from '../../core/workflow/session.js';
import { AGENT_ROLE_LABELS } from '../../agents/types.js';
import type { AgentRole } from '../../agents/types.js';
import type { TokenUsageEntry } from '../../core/workflow/token-tracker.js';
import { logger } from '../../utils/logger.js';

export const exportCommand = new Command('export')
    .description('Export a workflow session as a markdown or JSON report')
    .argument('[session-id]', 'Session ID to export (default: most recent)')
    .option('--format <format>', 'Output format: md or json (default: md)', 'md')
    .option('-o, --output <file>', 'Write report to file (default: stdout)')
    .action(async (sessionId: string | undefined, options: { format: string; output?: string }) => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exit(1);
        }

        if (options.format !== 'md' && options.format !== 'json') {
            logger.error('Invalid format. Use "md" or "json".');
            process.exit(1);
        }

        // Resolve session
        let id = sessionId;
        if (!id) {
            const sessions = listSessions(projectRoot);
            if (sessions.length === 0) {
                logger.error('No sessions found. Run a workflow first with "aiagentflow run".');
                process.exit(1);
            }
            id = sessions[0]!.id;
        }

        const session = loadSession(projectRoot, id);
        if (!session) {
            logger.error(`Session not found: ${id}`);
            process.exit(1);
        }

        const report = options.format === 'json'
            ? buildJsonReport(session)
            : buildMarkdownReport(session);

        if (options.output) {
            writeFileSync(options.output, report, 'utf-8');
            logger.success(`Report written to ${options.output}`);
        } else {
            process.stdout.write(report + '\n');
        }
    });

// ── Report builders ──

interface SessionLike {
    id: string;
    createdAt: number;
    updatedAt: number;
    context: {
        task: string;
        state: string;
        iteration: number;
        maxIterations: number;
        generatedFiles: string[];
        testFiles: string[];
        reviewFeedback?: string;
        securityFindings?: string;
        testFailures?: string;
        history: Array<{ from: string; to: string; event: string; timestamp: number }>;
    };
    tokenUsage: readonly TokenUsageEntry[];
}

function buildMarkdownReport(session: SessionLike): string {
    const ctx = session.context;
    const durationMs = session.updatedAt - session.createdAt;
    const duration = formatDuration(durationMs);
    const passed = ctx.state === 'qa_approved' || ctx.state === 'complete';
    const status = passed ? '✅ Passed' : ctx.state === 'failed' ? '❌ Failed' : `⏸ ${ctx.state}`;

    const lines: string[] = [
        `# Workflow Report`,
        ``,
        `**Task:** ${ctx.task}`,
        `**Status:** ${status}`,
        `**Session:** \`${session.id}\``,
        `**Date:** ${new Date(session.createdAt).toISOString()}`,
        `**Duration:** ${duration}`,
        `**Iterations:** ${ctx.iteration} / ${ctx.maxIterations}`,
        ``,
    ];

    if (ctx.generatedFiles.length > 0) {
        lines.push(`## Files Modified`);
        lines.push(``);
        for (const f of ctx.generatedFiles) {
            lines.push(`- \`${f}\``);
        }
        lines.push(``);
    }

    if (ctx.testFiles.length > 0) {
        lines.push(`## Test Files`);
        lines.push(``);
        for (const f of ctx.testFiles) {
            lines.push(`- \`${f}\``);
        }
        lines.push(``);
    }

    if (ctx.reviewFeedback) {
        lines.push(`## Code Review`);
        lines.push(``);
        lines.push(ctx.reviewFeedback);
        lines.push(``);
    }

    if (ctx.securityFindings) {
        lines.push(`## Security Review`);
        lines.push(``);
        lines.push(ctx.securityFindings);
        lines.push(``);
    }

    if (ctx.testFailures) {
        lines.push(`## Test Failures`);
        lines.push(``);
        lines.push('```');
        lines.push(ctx.testFailures);
        lines.push('```');
        lines.push(``);
    }

    if (ctx.history.length > 0) {
        lines.push(`## Timeline`);
        lines.push(``);
        lines.push('| Step | From | Event | To | Time |');
        lines.push('|------|------|-------|----|------|');
        for (let i = 0; i < ctx.history.length; i++) {
            const h = ctx.history[i]!;
            const t = new Date(h.timestamp).toISOString().slice(11, 19);
            lines.push(`| ${i + 1} | \`${h.from}\` | \`${h.event}\` | \`${h.to}\` | ${t} |`);
        }
        lines.push(``);
    }

    if (session.tokenUsage.length > 0) {
        lines.push(`## Token Usage`);
        lines.push(``);
        lines.push('| Agent | Model | Tokens |');
        lines.push('|-------|-------|--------|');
        let total = 0;
        for (const entry of session.tokenUsage) {
            const label = AGENT_ROLE_LABELS[entry.role as AgentRole] ?? entry.role;
            lines.push(`| ${label} | \`${entry.model}\` | ${entry.totalTokens.toLocaleString()} |`);
            total += entry.totalTokens;
        }
        lines.push(`| **Total** | | **${total.toLocaleString()}** |`);
        lines.push(``);
    }

    return lines.join('\n');
}

function buildJsonReport(session: SessionLike): string {
    const ctx = session.context;
    const totalTokens = session.tokenUsage.reduce((s, e) => s + e.totalTokens, 0);

    return JSON.stringify({
        id: session.id,
        task: ctx.task,
        status: ctx.state,
        passed: ctx.state === 'qa_approved' || ctx.state === 'complete',
        createdAt: new Date(session.createdAt).toISOString(),
        updatedAt: new Date(session.updatedAt).toISOString(),
        durationMs: session.updatedAt - session.createdAt,
        iterations: { used: ctx.iteration, max: ctx.maxIterations },
        files: { source: ctx.generatedFiles, tests: ctx.testFiles },
        reviewFeedback: ctx.reviewFeedback ?? null,
        securityFindings: ctx.securityFindings ?? null,
        testFailures: ctx.testFailures ?? null,
        history: ctx.history,
        tokenUsage: {
            total: totalTokens,
            entries: session.tokenUsage,
        },
    }, null, 2);
}

function formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}
