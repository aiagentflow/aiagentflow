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

/** Token usage for a single agent call. */
export interface TokenUsageEntry {
  role: AgentRole;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: number;
}

/** Estimated cost per 1M tokens for known models. */
const COST_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 1.0, output: 5.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  // Ollama (local — free)
  'llama3.2:latest': { input: 0, output: 0 },
  'codellama:latest': { input: 0, output: 0 },
  'deepseek-coder:latest': { input: 0, output: 0 },
};

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
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
  ): void {
    this.entries.push({
      role,
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      timestamp: Date.now(),
    });
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
    let totalCost = 0;

    for (const entry of this.entries) {
      const pricing = COST_PER_1M_TOKENS[entry.model];
      if (pricing) {
        totalCost += (entry.promptTokens / 1_000_000) * pricing.input;
        totalCost += (entry.completionTokens / 1_000_000) * pricing.output;
      }
    }

    return totalCost;
  }

  /**
   * Get all recorded entries.
   */
  getEntries(): readonly TokenUsageEntry[] {
    return this.entries;
  }

  /**
   * Print a summary of token usage to the console.
   */
  printSummary(): void {
    if (this.entries.length === 0) return;

    console.log();
    logger.header('Token Usage');

    const byRole = this.getTokensByRole();
    for (const [role, tokens] of Object.entries(byRole)) {
      const label = AGENT_ROLE_LABELS[role as AgentRole] ?? role;
      console.log(chalk.gray(`  ${label}: ${tokens.toLocaleString()} tokens`));
    }

    console.log(chalk.bold(`  Total: ${this.getTotalTokens().toLocaleString()} tokens`));

    const cost = this.estimateCost();
    if (cost > 0) {
      console.log(chalk.yellow(`  Estimated cost: $${cost.toFixed(4)}`));
    }
  }
}
