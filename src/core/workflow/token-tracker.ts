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

/** Anthropic bills cache reads at 0.1x and cache writes at 1.25x the input price. */
function anthropic(input: number, output: number): ModelPricing {
    return { input, output, cacheRead: input * 0.1, cacheWrite: input * 1.25 };
}

/** Estimated cost per 1M tokens for known models. */
export const COST_PER_1M_TOKENS: Record<string, ModelPricing> = {
    // Anthropic
    'claude-sonnet-4-20250514': anthropic(3.00, 15.00),
    'claude-opus-4-7': anthropic(15.00, 75.00),
    'claude-sonnet-4-6': anthropic(3.00, 15.00),
    'claude-haiku-4-5-20251001': anthropic(0.80, 4.00),
    'claude-3-5-haiku-20241022': anthropic(1.00, 5.00),
    'claude-3-opus-20240229': anthropic(15.00, 75.00),
    // OpenAI
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'o1': { input: 15.00, output: 60.00 },
    'o1-mini': { input: 3.00, output: 12.00 },
    // Google Gemini
    'gemini-2.0-flash': { input: 0.10, output: 0.40 },
    'gemini-2.0-flash-lite': { input: 0.075, output: 0.30 },
    'gemini-1.5-pro': { input: 1.25, output: 5.00 },
    // Groq (hosted — not billed per token like API)
    'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
    'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },
    // Ollama (local — free)
    'llama3.2:latest': { input: 0, output: 0 },
    'codellama:latest': { input: 0, output: 0 },
    'deepseek-coder:latest': { input: 0, output: 0 },
    'deepseek-r1:latest': { input: 0, output: 0 },
    // OpenRouter — free tier models (":free" suffix)
    'meta-llama/llama-3.1-8b-instruct:free': { input: 0, output: 0 },
    'google/gemma-3-12b-it:free': { input: 0, output: 0 },
    'mistralai/mistral-7b-instruct:free': { input: 0, output: 0 },
    // OpenRouter — paid models (via proxy, pricing approximate)
    'meta-llama/llama-3.1-70b-instruct': { input: 0.35, output: 0.40 },
    'mistralai/mixtral-8x7b-instruct': { input: 0.24, output: 0.24 },
    'deepseek/deepseek-r1': { input: 0.55, output: 2.19 },
};

/**
 * Estimated USD cost of one usage entry, or 0 for unknown models.
 * Cached input is priced at the cache rates; the rest at the input rate.
 */
export function costOf(entry: Pick<TokenUsageEntry, 'model' | 'promptTokens' | 'completionTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>): number {
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
    ): void {
        this.entries.push({
            role,
            model,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            ...(usage.cacheReadTokens ? { cacheReadTokens: usage.cacheReadTokens } : {}),
            ...(usage.cacheWriteTokens ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
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
