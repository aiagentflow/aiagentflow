/**
 * Eval reports: a summary plus per-task rows, as a terminal table or JSON.
 *
 * Dependency direction: eval/report.ts → eval/runner (types)
 * Used by: cli/commands/eval.ts
 */

import type { EvalResult } from './runner.js';

export interface EvalSummary {
    tasks: number;
    passed: number;
    passRate: number;
    totalTokens: number;
    costUsd: number;
    durationMs: number;
    /** Mean fix iterations per task. */
    meanIterations: number;
}

export function summarize(results: readonly EvalResult[]): EvalSummary {
    const passed = results.filter(r => r.passed).length;
    const sum = (f: (r: EvalResult) => number) => results.reduce((s, r) => s + f(r), 0);
    return {
        tasks: results.length,
        passed,
        passRate: results.length > 0 ? passed / results.length : 0,
        totalTokens: sum(r => r.totalTokens),
        costUsd: sum(r => r.costUsd),
        durationMs: sum(r => r.durationMs),
        meanIterations: results.length > 0 ? sum(r => r.iterations) / results.length : 0,
    };
}

/** The JSON report: when, how, summary, and every result. */
export function buildJsonReport(results: readonly EvalResult[], meta: { workflow: string; models: Record<string, string> }): string {
    return JSON.stringify({ createdAt: new Date().toISOString(), ...meta, summary: summarize(results), results }, null, 2);
}

/** Plain-text table for the terminal. */
export function formatEvalTable(results: readonly EvalResult[]): string {
    const header = ['Task', 'Lang', 'Result', 'Iter', 'Tokens', 'Cost', 'Time'];
    const rows = results.map(r => [
        r.id,
        r.language,
        r.passed ? 'PASS' : r.failureKind && r.failureKind !== 'checks' ? `FAIL (${r.failureKind})` : 'FAIL',
        String(r.iterations),
        r.totalTokens.toLocaleString('en-US'),
        r.costUsd > 0 ? `$${r.costUsd.toFixed(4)}` : '-',
        `${Math.round(r.durationMs / 1000)}s`,
    ]);
    const s = summarize(results);
    const footer = [
        'Total',
        '',
        `${s.passed}/${s.tasks} (${Math.round(s.passRate * 100)}%)`,
        s.meanIterations.toFixed(1),
        s.totalTokens.toLocaleString('en-US'),
        s.costUsd > 0 ? `$${s.costUsd.toFixed(4)}` : '-',
        `${Math.round(s.durationMs / 1000)}s`,
    ];

    const all = [header, ...rows, footer];
    const widths = header.map((_, i) => Math.max(...all.map(row => row[i]!.length)));
    const line = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i]!)).join('  ').trimEnd();
    const rule = widths.map(w => '-'.repeat(w)).join('  ');
    return [line(header), rule, ...rows.map(line), rule, line(footer)].join('\n');
}
