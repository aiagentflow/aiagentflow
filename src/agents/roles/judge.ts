/**
 * Judge agent — evaluates if a task is complete and meets quality standards.
 *
 * Dependency direction: judge.ts → agents/base, prompts/library
 * Used by: workflow runner
 */

import { BaseAgent, type AgentInput, type AgentOutput } from '../base.js';
import { loadAgentPrompt } from '../../prompts/library.js';
import type { LLMProvider } from '../../providers/types.js';

export class JudgeAgent extends BaseAgent {
    private readonly projectRoot: string;

    constructor(
        provider: LLMProvider,
        options: { model: string; temperature?: number; maxTokens?: number },
        projectRoot: string,
    ) {
        // Low temperature for consistent pass/fail decisions
        super('judge', provider, { ...options, temperature: options.temperature ?? 0.2 });
        this.projectRoot = projectRoot;
    }

    protected buildSystemPrompt(): string {
        return loadAgentPrompt(this.projectRoot, 'judge');
    }

    protected buildUserPrompt(input: AgentInput): string {
        let prompt = `## Original Task\n\n${input.task}\n\n`;

        if (input.previousOutput) {
            prompt += `## Implementation Summary\n\n${input.previousOutput}\n`;
        }

        if (input.context) {
            prompt += `\n## Review & Test Results\n\n${input.context}\n`;
        }

        return prompt;
    }

    /**
     * Check if the judge approves.
     * Looks for "PASS" in the output (case-insensitive).
     */
    static isPassed(output: AgentOutput): boolean {
        const content = output.content.toUpperCase();
        return content.includes('PASS') && !content.includes('FAIL');
    }
}
