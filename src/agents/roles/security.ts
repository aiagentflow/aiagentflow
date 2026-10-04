import type { AgentInput, AgentOptions } from '../base.js';
import { VerdictAgent } from '../verdict-agent.js';
import { loadAgentPrompt, loadCodingStandards } from '../../prompts/library.js';
import type { LLMProvider } from '../../providers/types.js';

export class SecurityAgent extends VerdictAgent {
    private readonly projectRoot: string;

    constructor(
        provider: LLMProvider,
        options: AgentOptions,
        projectRoot: string,
    ) {
        super('security', provider, { ...options, temperature: options.temperature ?? 0.2 });
        this.projectRoot = projectRoot;
    }

    protected buildSystemPrompt(): string {
        const rolePrompt = loadAgentPrompt(this.projectRoot, 'security');
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
            prompt += `\n## Context\n\n${input.context}\n`;
        }

        if (input.previousOutput) {
            prompt += `\n## Code to Review\n\n${input.previousOutput}\n`;
        }

        return prompt;
    }
}
