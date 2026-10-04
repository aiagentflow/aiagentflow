/**
 * Reviewer agent — reviews code and provides feedback.
 *
 * Dependency direction: reviewer.ts → agents/base, prompts/library
 * Used by: workflow runner
 */

import type { AgentInput, AgentOptions } from '../base.js';
import { VerdictAgent } from '../verdict-agent.js';
import { loadAgentPrompt, loadCodingStandards } from '../../prompts/library.js';
import type { LLMProvider } from '../../providers/types.js';

export class ReviewerAgent extends VerdictAgent {
    private readonly projectRoot: string;

    constructor(
        provider: LLMProvider,
        options: AgentOptions,
        projectRoot: string,
    ) {
        super('reviewer', provider, { ...options, temperature: options.temperature ?? 0.5 });
        this.projectRoot = projectRoot;
    }

    protected buildSystemPrompt(): string {
        const rolePrompt = loadAgentPrompt(this.projectRoot, 'reviewer');
        const standards = loadCodingStandards(this.projectRoot);

        let prompt = rolePrompt;
        if (standards) {
            prompt += `\n\n## Project Coding Standards (use these when reviewing)\n\n${standards}`;
        }
        return prompt;
    }

    protected buildUserPrompt(input: AgentInput): string {
        let prompt = `## Task Being Implemented\n\n${input.task}\n\n`;

        if (input.previousOutput) {
            prompt += `## Code To Review\n\n${input.previousOutput}\n`;
        }

        if (input.context) {
            prompt += `\n## Additional Context\n\n${input.context}\n`;
        }

        return prompt;
    }
}
