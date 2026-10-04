/**
 * Agent base class — defines the contract and shared behavior for all agents.
 *
 * Each specialized agent (Architect, Coder, Reviewer, etc.) extends this base
 * and implements the prompt builders. The base owns the tool loop: it calls
 * the model, executes any tools it requests through the ToolRegistry, sends
 * the results back, and repeats until the model gives a final answer.
 *
 * Dependency direction: agents/base.ts → providers/types, tools/registry, core/errors, utils
 * Used by: all agent implementations
 */

import type { LLMProvider, ChatMessage, ChatOptions, ToolCall, ToolResult } from '../providers/types.js';
import type { AgentRole, StreamCallbacks } from './types.js';
import type { ToolRegistry } from '../tools/registry.js';
import { ProviderError } from '../core/errors.js';
import { logger } from '../utils/logger.js';
import { AGENT_ROLE_LABELS } from './types.js';

/** Default number of model turns that may request tools before a final answer is forced. */
export const DEFAULT_MAX_TURNS = 10;

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

/** Options shared by every agent. */
export interface AgentOptions {
    model: string;
    temperature?: number;
    maxTokens?: number;
    /** Tools this agent may call. */
    tools?: ToolRegistry;
    /** Max model turns that may request tools (default: DEFAULT_MAX_TURNS). */
    maxTurns?: number;
}

/** One model turn, reduced to what the tool loop needs. */
interface TurnResult {
    content: string;
    toolCalls: readonly ToolCall[];
    tokens: number;
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
    protected readonly tools?: ToolRegistry;
    protected readonly maxTurns: number;
    /** Formatted memory section prepended to the system prompt. Set by factory. */
    memorySection = '';

    constructor(role: AgentRole, provider: LLMProvider, options: AgentOptions) {
        this.role = role;
        this.provider = provider;
        this.model = options.model;
        this.temperature = options.temperature ?? 0.7;
        this.maxTokens = options.maxTokens ?? 4096;
        this.tools = options.tools && options.tools.size > 0 ? options.tools : undefined;
        this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    }

    /**
     * Execute this agent's task.
     *
     * @throws {ProviderError} if the LLM call fails
     */
    async execute(input: AgentInput): Promise<AgentOutput> {
        const label = AGENT_ROLE_LABELS[this.role];
        logger.info(`${label} starting...`);

        try {
            const { content, tokens } = await this.runLoop(input, async (messages, options) => {
                const response = await this.provider.chat(messages, options);
                return { content: response.content, toolCalls: response.toolCalls, tokens: response.usage.totalTokens };
            });

            logger.success(`${label} complete (${tokens} tokens)`);
            return { content: this.parseResponse(content), role: this.role, tokensUsed: tokens, success: true };
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
     * Text is passed to `callbacks.onChunk` as it arrives; tool calls are
     * reported via `callbacks.onToolCall`. Falls back to execute() if
     * streaming fails or yields an empty final answer.
     */
    async executeStreaming(input: AgentInput, callbacks?: StreamCallbacks): Promise<AgentOutput> {
        const label = AGENT_ROLE_LABELS[this.role];
        logger.info(`${label} starting (streaming)...`);

        try {
            const { content, tokens } = await this.runLoop(input, async (messages, options) => {
                let text = '';
                const toolCalls: ToolCall[] = [];
                for await (const chunk of this.provider.stream(messages, options)) {
                    if (chunk.content) {
                        text += chunk.content;
                        callbacks?.onChunk?.(chunk.content);
                    }
                    for (const call of chunk.toolCalls ?? []) {
                        toolCalls.push(call);
                        callbacks?.onToolCall?.(call);
                    }
                }
                // Estimate: ~4 chars per token
                // TODO: use provider-reported usage for streams
                return { content: text, toolCalls, tokens: Math.ceil(text.length / 4) };
            });

            callbacks?.onComplete?.(content);

            // An empty answer usually means a compound model emitted only intermediate
            // events, or an API returned HTTP 200 with an empty body.
            if (!content) {
                logger.warn(`${label} streaming returned empty content — retrying without streaming`);
                return this.execute(input);
            }

            logger.success(`${label} complete (~${tokens} tokens)`);
            return { content, role: this.role, tokensUsed: tokens, success: true };
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

    /** Post-process the final answer. Override to extract structured data. */
    protected parseResponse(content: string): string {
        return content;
    }

    /**
     * The tool loop shared by execute() and executeStreaming().
     *
     * Calls `turn` until the model stops requesting tools. After `maxTurns`
     * tool-requesting turns, one final turn without tools forces a text answer.
     */
    private async runLoop(
        input: AgentInput,
        turn: (messages: ChatMessage[], options: ChatOptions) => Promise<TurnResult>,
    ): Promise<{ content: string; tokens: number }> {
        const systemPrompt = this.memorySection
            ? `${this.memorySection}\n\n${this.buildSystemPrompt()}`
            : this.buildSystemPrompt();
        const messages: ChatMessage[] = [{ role: 'user', content: this.buildUserPrompt(input) }];
        const options: ChatOptions = {
            model: this.model,
            temperature: this.temperature,
            maxTokens: this.maxTokens,
            systemPrompt,
            ...(this.tools ? { tools: this.tools.definitions } : {}),
        };

        let tokens = 0;
        for (let i = 0; i < this.maxTurns; i++) {
            const result = await turn(messages, options);
            tokens += result.tokens;

            if (result.toolCalls.length === 0 || !this.tools) {
                return { content: result.content, tokens };
            }

            const results: ToolResult[] = [];
            for (const call of result.toolCalls) {
                logger.debug(`${this.role} calling tool: ${call.name}`);
                results.push(await this.tools.execute(call));
            }
            messages.push(
                { role: 'assistant', content: result.content, toolCalls: result.toolCalls },
                { role: 'tool', results },
            );
        }

        logger.warn(`${AGENT_ROLE_LABELS[this.role]} hit the tool-call limit (${this.maxTurns}); requesting a final answer`);
        const final = await turn(messages, { ...options, tools: undefined });
        return { content: final.content, tokens: tokens + final.tokens };
    }
}
