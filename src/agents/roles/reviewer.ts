/**
 * Reviewer agent — reviews code and provides feedback.
 *
 * Dependency direction: reviewer.ts → agents/base, prompts/library
 * Used by: workflow runner
 */

import { BaseAgent, type AgentInput, type AgentOutput } from '../base.js';
import { loadAgentPrompt, loadCodingStandards } from '../../prompts/library.js';
import type { LLMProvider, ChatResponse } from '../../providers/types.js';

export class ReviewerAgent extends BaseAgent {
  private readonly projectRoot: string;

  constructor(
    provider: LLMProvider,
    options: { model: string; temperature?: number; maxTokens?: number },
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

  /**
   * Parse the review response to extract approval status.
   */
  protected override parseResponse(response: ChatResponse): string {
    return response.content;
  }

  /**
   * Check if the review approves the code.
   * Looks for "APPROVE" in the output (case-insensitive).
   */
  static isApproved(output: AgentOutput): boolean {
    const content = output.content.toUpperCase();
    return content.includes('APPROVE') && !content.includes('REQUEST_CHANGES');
  }
}
