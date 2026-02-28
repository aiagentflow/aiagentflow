/**
 * Tester agent — generates tests for implemented code.
 *
 * Dependency direction: tester.ts → agents/base, prompts/library
 * Used by: workflow runner
 */

import { BaseAgent, type AgentInput } from '../base.js';
import { loadAgentPrompt } from '../../prompts/library.js';
import type { LLMProvider } from '../../providers/types.js';

export class TesterAgent extends BaseAgent {
  private readonly projectRoot: string;

  constructor(
    provider: LLMProvider,
    options: { model: string; temperature?: number; maxTokens?: number },
    projectRoot: string,
  ) {
    super('tester', provider, { ...options, temperature: options.temperature ?? 0.4 });
    this.projectRoot = projectRoot;
  }

  protected buildSystemPrompt(): string {
    return loadAgentPrompt(this.projectRoot, 'tester');
  }

  protected buildUserPrompt(input: AgentInput): string {
    let prompt = `## Task\n\n${input.task}\n\n`;

    if (input.previousOutput) {
      prompt += `## Code To Test\n\n${input.previousOutput}\n`;
    }

    if (input.context) {
      prompt += `\n## Test Framework & Context\n\n${input.context}\n`;
    }

    return prompt;
  }
}
