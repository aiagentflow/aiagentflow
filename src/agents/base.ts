/**
 * Agent base class — defines the contract and shared behavior for all agents.
 *
 * Each specialized agent (Architect, Coder, Reviewer, etc.) extends this base
 * and implements the `execute()` method with role-specific logic.
 *
 * Dependency direction: agents/base.ts → providers/types, core/errors, utils
 * Used by: all agent implementations
 */

import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse } from '../providers/types.js';
import type { AgentRole, StreamCallbacks } from './types.js';
import { ProviderError } from '../core/errors.js';
import { logger } from '../utils/logger.js';
import { AGENT_ROLE_LABELS } from './types.js';

/** Input that an agent receives to do its work. */
export interface AgentInput {
    /** The task or instruction for the agent. */
    task: string;
    /** Additional context (e.g., code files, review feedback, test results). */
    context?: string;
    /** Previous agent outputs to build upon. */
    previousOutput?: string;
}

/** Output that an agent produces after execution. */
export interface AgentOutput {
    /** The agent's generated content (code, review, spec, etc.). */
    content: string;
    /** Which agent produced this output. */
    role: AgentRole;
    /** Token usage for this agent call. */
    tokensUsed: number;
    /** Whether the agent considers its task done successfully. */
    success: boolean;
    /** Optional metadata from the agent. */
    metadata?: Record<string, unknown>;
}

/**
 * Base class for all agents.
 *
 * To create a new agent:
 * 1. Extend this class
 * 2. Implement `buildSystemPrompt()` — the agent's role instructions
 * 3. Implement `buildUserPrompt(input)` — formats the task for the LLM
 * 4. Optionally override `parseResponse()` to extract structured data
 */
export abstract class BaseAgent {
    public readonly role: AgentRole;
    protected readonly provider: LLMProvider;
    protected readonly model: string;
    protected readonly temperature: number;
    protected readonly maxTokens: number;

    constructor(
        role: AgentRole,
        provider: LLMProvider,
        options: { model: string; temperature?: number; maxTokens?: number },
    ) {
        this.role = role;
        this.provider = provider;
        this.model = options.model;
        this.temperature = options.temperature ?? 0.7;
        this.maxTokens = options.maxTokens ?? 4096;
    }

    /**
     * Execute this agent's task.
     *
     * @param input - The task description and context
     * @returns The agent's output
     * @throws {ProviderError} if the LLM call fails
     */
    async execute(input: AgentInput): Promise<AgentOutput> {
        const label = AGENT_ROLE_LABELS[this.role];
        logger.info(`${label} starting...`);

        const systemPrompt = this.buildSystemPrompt();
        const userPrompt = this.buildUserPrompt(input);

        const messages: ChatMessage[] = [
            { role: 'user', content: userPrompt },
        ];

        const options: ChatOptions = {
            model: this.model,
            temperature: this.temperature,
            maxTokens: this.maxTokens,
            systemPrompt,
        };

        try {
            const response = await this.provider.chat(messages, options);
            const content = this.parseResponse(response);

            logger.success(`${label} complete (${response.usage.totalTokens} tokens)`);

            return {
                content,
                role: this.role,
                tokensUsed: response.usage.totalTokens,
                success: true,
            };
        } catch (err) {
            if (err instanceof ProviderError) throw err;
            throw new ProviderError(
                `${label} failed: ${err instanceof Error ? err.message : String(err)}`,
                { role: this.role, model: this.model },
            );
        }
    }

    /**
     * Execute this agent's task with streaming output.
     *
     * Uses the provider's stream() method and calls callbacks for each chunk.
     * Falls back to execute() if streaming fails.
     */
    async executeStreaming(input: AgentInput, callbacks?: StreamCallbacks): Promise<AgentOutput> {
        const label = AGENT_ROLE_LABELS[this.role];
        logger.info(`${label} starting (streaming)...`);

        const systemPrompt = this.buildSystemPrompt();
        const userPrompt = this.buildUserPrompt(input);

        const messages: ChatMessage[] = [
            { role: 'user', content: userPrompt },
        ];

        const options: ChatOptions = {
            model: this.model,
            temperature: this.temperature,
            maxTokens: this.maxTokens,
            systemPrompt,
        };

        try {
            let accumulated = '';
            for await (const chunk of this.provider.stream(messages, options)) {
                if (chunk.content) {
                    accumulated += chunk.content;
                    callbacks?.onChunk?.(chunk.content);
                }
            }

            callbacks?.onComplete?.(accumulated);

            // Estimate token count: ~4 chars per token
            // TODO: use per-provider tokenizer for accuracy
            const estimatedTokens = Math.ceil(accumulated.length / 4);

            logger.success(`${label} complete (~${estimatedTokens} tokens)`);

            return {
                content: accumulated,
                role: this.role,
                tokensUsed: estimatedTokens,
                success: true,
            };
        } catch (err) {
            logger.warn(`${label} streaming failed, falling back to non-streaming`);
            logger.debug(`Stream error: ${err instanceof Error ? err.message : String(err)}`);
            return this.execute(input);
        }
    }

    /** Build the system prompt that defines this agent's role and behavior. */
    protected abstract buildSystemPrompt(): string;

    /** Build the user prompt from the input task and context. */
    protected abstract buildUserPrompt(input: AgentInput): string;

    /** Parse the LLM response. Override to extract structured data. */
    protected parseResponse(response: ChatResponse): string {
        return response.content;
    }
}
