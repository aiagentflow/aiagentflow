/**
 * Token tracker — accumulates token usage across agent calls.
 *
 * Tracks per-agent and total token consumption for cost estimation
 * and usage visibility.
 *
 * Dependency direction: token-tracker.ts → utils
 * Used by: workflow runner
 */

import chalk from 'chalk';
import type { AgentRole } from '../../agents/types.js';
import { AGENT_ROLE_LABELS } from '../../agents/types.js';
import { logger } from '../../utils/logger.js';
import type { TokenUsage } from '../../providers/types.js';

/** Token usage for a single agent call. */
export interface TokenUsageEntry {
    role: AgentRole;
    model: string;
    /** All input tokens, including cached ones. */
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Input tokens read from the prompt cache (subset of promptTokens). */
    cacheReadTokens?: number;
    /** Input tokens written to the prompt cache (subset of promptTokens). */
    cacheWriteTokens?: number;
    /** Cost reported by the runner itself (e.g. an external agent CLI); overrides the pricing table. */
    costUsd?: number;
    timestamp: number;
}

/**
 * USD per 1M tokens. Cache prices default to the input price when a model
 * does not list them, which over-estimates rather than hides cost.
 */
export interface ModelPricing {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
}

/** Claude: 5-minute cache writes bill at 1.25x input; cache reads are listed per model. */
function claude(input: number, output: number, cacheRead = input * 0.1): ModelPricing {
    return { input, output, cacheRead, cacheWrite: input * 1.25 };
}

/**
 * USD per 1M tokens, standard tier, prompts up to 200K tokens.
 *
 * Bundled rather than fetched so cost estimates work offline (aiagentflow is
 * local-first). Sources, checked October 2026: Anthropic and OpenAI pricing
 * docs, ai.google.dev/gemini-api/docs/pricing. Refresh every release. Models
 * not listed show no cost; OpenRouter ":free" models cost nothing.
 */
export const COST_PER_1M_TOKENS: Record<string, ModelPricing> = {
    // Anthropic
    'claude-fable-5-1': claude(10.00, 50.00, 0.25),
    'claude-fable-5': claude(10.00, 50.00),
    'claude-opus-5-5': claude(4.00, 20.00, 0.20),
    'claude-opus-5': claude(5.00, 25.00),
    'claude-opus-4-8': claude(5.00, 25.00),
    'claude-opus-4-7': claude(5.00, 25.00),
    'claude-opus-4-6': claude(5.00, 25.00),
    'claude-sonnet-5-5': claude(2.00, 10.00, 0.20),
    'claude-sonnet-5': claude(2.00, 10.00),
    'claude-sonnet-4-6': claude(3.00, 15.00),
    'claude-sonnet-4-20250514': claude(3.00, 15.00),
    'claude-haiku-4-5': claude(1.00, 5.00),
    'claude-haiku-4-5-20251001': claude(1.00, 5.00),
    // OpenAI (cached input listed per model)
    'gpt-6-astra': { input: 10.00, output: 50.00, cacheRead: 1.00 },
    'gpt-6.1-sol': { input: 2.00, output: 10.00, cacheRead: 0.10 },
    'gpt-6-sol': { input: 2.00, output: 10.00, cacheRead: 0.20 },
    'gpt-6-luna': { input: 0.10, output: 0.50, cacheRead: 0.01 },
    'gpt-5.6-sol': { input: 4.00, output: 20.00, cacheRead: 0.40 },
    'gpt-5.6-luna': { input: 0.20, output: 1.20, cacheRead: 0.02 },
    'gpt-5.4-mini': { input: 0.75, output: 4.50, cacheRead: 0.075 },
    'gpt-5.4-nano': { input: 0.20, output: 1.25, cacheRead: 0.02 },
    'gpt-5-mini': { input: 0.25, output: 2.00, cacheRead: 0.025 },
    'gpt-5-nano': { input: 0.05, output: 0.40, cacheRead: 0.005 },
    'gpt-4.1-mini': { input: 0.40, output: 1.60, cacheRead: 0.10 },
    'gpt-4o-mini': { input: 0.15, output: 0.60, cacheRead: 0.075 },
    // Google Gemini (context-cache reads listed per model)
    'gemini-3.8-flash': { input: 0.75, output: 3.75, cacheRead: 0.075 },
    'gemini-3.7-flash': { input: 0.75, output: 3.75, cacheRead: 0.075 },
    'gemini-3.6-flash': { input: 0.75, output: 3.75, cacheRead: 0.075 },
    'gemini-3.5-flash': { input: 1.50, output: 9.00, cacheRead: 0.15 },
    'gemini-3.5-flash-lite': { input: 0.30, output: 2.50, cacheRead: 0.03 },
    'gemini-2.5-pro': { input: 1.25, output: 10.00, cacheRead: 0.125 },
    'gemini-2.5-flash': { input: 0.30, output: 2.50, cacheRead: 0.03 },
    'gemini-2.5-flash-lite': { input: 0.10, output: 0.40, cacheRead: 0.01 },
    // Groq (approximate; Groq bills per model on its console)
    'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
    // Ollama runs locally: local models are free
    'llama3.2:latest': { input: 0, output: 0 },
};

/**
 * Estimated USD cost of one usage entry, or 0 for unknown models.
 * Cached input is priced at the cache rates; the rest at the input rate.
 */
export function costOf(entry: Pick<TokenUsageEntry, 'model' | 'promptTokens' | 'completionTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'costUsd'>): number {
    if (entry.costUsd !== undefined) return entry.costUsd;
    if (entry.model.endsWith(':free')) return 0;
    const pricing = COST_PER_1M_TOKENS[entry.model];
    if (!pricing) return 0;
    const cacheRead = entry.cacheReadTokens ?? 0;
    const cacheWrite = entry.cacheWriteTokens ?? 0;
    const uncached = Math.max(0, entry.promptTokens - cacheRead - cacheWrite);
    return (
        uncached * pricing.input +
        cacheRead * (pricing.cacheRead ?? pricing.input) +
        cacheWrite * (pricing.cacheWrite ?? pricing.input) +
        entry.completionTokens * pricing.output
    ) / 1_000_000;
}

/**
 * Token usage tracker for a workflow run.
 */
export class TokenTracker {
    private readonly entries: TokenUsageEntry[] = [];

    /**
     * Record a token usage entry.
     */
    record(
        role: AgentRole,
        model: string,
        usage: TokenUsage,
        costUsd?: number,
    ): void {
        this.entries.push({
            role,
            model,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            ...(usage.cacheReadTokens ? { cacheReadTokens: usage.cacheReadTokens } : {}),
            ...(usage.cacheWriteTokens ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
            ...(costUsd !== undefined ? { costUsd } : {}),
            timestamp: Date.now(),
        });
    }

    /**
     * Restore previously saved token usage entries (for session resume).
     */
    restoreEntries(entries: readonly TokenUsageEntry[]): void {
        for (const entry of entries) {
            this.entries.push({ ...entry });
        }
    }

    /**
     * Get total tokens used across all agents.
     */
    getTotalTokens(): number {
        return this.entries.reduce((sum, e) => sum + e.totalTokens, 0);
    }

    /**
     * Get tokens used per agent role.
     */
    getTokensByRole(): Record<string, number> {
        const byRole: Record<string, number> = {};
        for (const entry of this.entries) {
            byRole[entry.role] = (byRole[entry.role] ?? 0) + entry.totalTokens;
        }
        return byRole;
    }

    /**
     * Estimate total cost in USD based on known model pricing.
     */
    estimateCost(): number {
        return this.entries.reduce((sum, e) => sum + costOf(e), 0);
    }

    /**
     * Get all recorded entries.
     */
    getEntries(): readonly TokenUsageEntry[] {
        return this.entries;
    }

    /**
     * Print a summary of token usage to the console.
     * @param elapsedMs Optional total wall-clock time in milliseconds.
     */
    printSummary(elapsedMs?: number): void {
        if (this.entries.length === 0) return;

        console.log();
        logger.header('Run Summary');

        // Per-agent breakdown: tokens + cost
        const byRole: Record<string, { tokens: number; cost: number; model: string }> = {};
        for (const entry of this.entries) {
            const row = byRole[entry.role] ?? (byRole[entry.role] = { tokens: 0, cost: 0, model: entry.model });
            row.tokens += entry.totalTokens;
            row.cost += costOf(entry);
        }

        const colWidths = [22, 12, 12, 10];
        const header = ['Agent', 'Tokens', 'Cost (USD)', 'Model'].map((h, i) => h.padEnd(colWidths[i]!));
        console.log(chalk.gray(`  ${header.join('')}`));
        console.log(chalk.gray('  ' + '─'.repeat(56)));

        let totalCost = 0;
        for (const [role, data] of Object.entries(byRole)) {
            const label = AGENT_ROLE_LABELS[role as AgentRole] ?? role;
            const cost = data.cost;
            totalCost += cost;
            const costStr = cost > 0 ? `$${cost.toFixed(4)}` : '—';
            const shortModel = data.model.length > 22 ? data.model.slice(0, 19) + '...' : data.model;
            console.log(chalk.gray(
                `  ${label.padEnd(colWidths[0]!)}${data.tokens.toLocaleString().padEnd(colWidths[1]!)}${costStr.padEnd(colWidths[2]!)}${shortModel}`,
            ));
        }

        console.log(chalk.gray('  ' + '─'.repeat(56)));
        const totalStr = `  ${'Total'.padEnd(colWidths[0]!)}${this.getTotalTokens().toLocaleString().padEnd(colWidths[1]!)}`;
        const costTotal = totalCost > 0 ? chalk.yellow(`$${totalCost.toFixed(4)}`) : chalk.gray('—');
        console.log(chalk.bold(totalStr) + costTotal);

        const prompt = this.entries.reduce((s, e) => s + e.promptTokens, 0);
        const cached = this.entries.reduce((s, e) => s + (e.cacheReadTokens ?? 0), 0);
        if (cached > 0 && prompt > 0) {
            console.log(chalk.gray(`  Cache reads: ${cached.toLocaleString()} of ${prompt.toLocaleString()} input tokens (${Math.round((cached / prompt) * 100)}%)`));
        }

        if (elapsedMs !== undefined) {
            console.log(chalk.gray(`  Wall clock: ${formatDuration(elapsedMs)}`));
        }

        console.log();
    }
}

function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSec = seconds % 60;
    return `${minutes}m ${remainingSec}s`;
}
