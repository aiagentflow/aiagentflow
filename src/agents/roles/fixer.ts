/**
 * Fixer agent — fixes bugs found by reviewers and test failures.
 *
 * Dependency direction: fixer.ts → agents/base, prompts/library
 * Used by: workflow runner
 */

import { BaseAgent, type AgentInput } from '../base.js';
import { loadAgentPrompt } from '../../prompts/library.js';
import type { LLMProvider } from '../../providers/types.js';

export class FixerAgent extends BaseAgent {
    private readonly projectRoot: string;

    constructor(
        provider: LLMProvider,
        options: { model: string; temperature?: number; maxTokens?: number },
        projectRoot: string,
    ) {
        super('fixer', provider, { ...options, temperature: options.temperature ?? 0.3 });
        this.projectRoot = projectRoot;
    }

    protected buildSystemPrompt(): string {
        return loadAgentPrompt(this.projectRoot, 'fixer');
    }

    protected buildUserPrompt(input: AgentInput): string {
        let prompt = `## Original Task\n\n${input.task}\n\n`;

        if (input.context) {
            prompt += `## Error Details\n\n${input.context}\n\n`;
        }

        if (input.previousOutput) {
            prompt += `## Current Code (with bugs)\n\n${input.previousOutput}\n`;
        }

        return prompt;
    }
}
