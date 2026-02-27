/**
 * Architect agent — analyzes a task and creates an implementation plan.
 *
 * This is the first agent in the pipeline. It reads the task description,
 * understands the project context, and outputs a structured plan that the
 * Coder agent will follow.
 *
 * Dependency direction: architect.ts → agents/base, prompts/library
 * Used by: workflow runner
 */

import { BaseAgent, type AgentInput } from '../base.js';
import { loadAgentPrompt, loadCodingStandards } from '../../prompts/library.js';
import type { LLMProvider } from '../../providers/types.js';

export class ArchitectAgent extends BaseAgent {
    private readonly projectRoot: string;

    constructor(
        provider: LLMProvider,
        options: { model: string; temperature?: number; maxTokens?: number },
        projectRoot: string,
    ) {
        super('architect', provider, { ...options, temperature: options.temperature ?? 0.8 });
        this.projectRoot = projectRoot;
    }

    protected buildSystemPrompt(): string {
        const rolePrompt = loadAgentPrompt(this.projectRoot, 'architect');
        const standards = loadCodingStandards(this.projectRoot);

        let prompt = rolePrompt;
        if (standards) {
            prompt += `\n\n## Project Coding Standards\n\n${standards}`;
        }
        return prompt;
    }

    protected buildUserPrompt(input: AgentInput): string {
        let prompt = `## Task\n\n${input.task}\n`;

        if (input.context) {
            prompt += `\n## Project Context\n\n${input.context}\n`;
        }

        if (input.previousOutput) {
            prompt += `\n## Previous Feedback\n\n${input.previousOutput}\n`;
        }

        return prompt;
    }
}
