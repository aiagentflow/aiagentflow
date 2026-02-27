/**
 * Coder agent — implements code based on the architect's plan.
 *
 * Dependency direction: coder.ts → agents/base, prompts/library
 * Used by: workflow runner
 */

import { BaseAgent, type AgentInput } from '../base.js';
import { loadAgentPrompt, loadCodingStandards } from '../../prompts/library.js';
import type { LLMProvider } from '../../providers/types.js';

export class CoderAgent extends BaseAgent {
    private readonly projectRoot: string;

    constructor(
        provider: LLMProvider,
        options: { model: string; temperature?: number; maxTokens?: number },
        projectRoot: string,
    ) {
        // Lower temperature for deterministic code generation
        super('coder', provider, { ...options, temperature: options.temperature ?? 0.3 });
        this.projectRoot = projectRoot;
    }

    protected buildSystemPrompt(): string {
        const rolePrompt = loadAgentPrompt(this.projectRoot, 'coder');
        const standards = loadCodingStandards(this.projectRoot);

        let prompt = rolePrompt;
        if (standards) {
            prompt += `\n\n## Project Coding Standards\n\n${standards}`;
        }
        return prompt;
    }

    protected buildUserPrompt(input: AgentInput): string {
        let prompt = '';

        // The architect's plan is the primary input
        if (input.previousOutput) {
            prompt += `## Implementation Plan\n\n${input.previousOutput}\n\n`;
        }

        prompt += `## Task\n\n${input.task}\n`;

        if (input.context) {
            prompt += `\n## Existing Code Context\n\n${input.context}\n`;
        }

        return prompt;
    }
}
