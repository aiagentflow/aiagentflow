/**
 * MockProvider — scripted LLM provider for deterministic workflow tests.
 *
 * Replays a queue of responses in order. A step with `toolCalls` returns them
 * with stopReason `tool_use`; the agent executes them and calls again, which
 * consumes the next step. Every call is recorded so tests can assert on the
 * messages and options each agent sent.
 */

import type {
    LLMProvider,
    LLMProviderName,
    ChatMessage,
    ChatOptions,
    ChatResponse,
    ChatChunk,
    ModelInfo,
    ToolCall,
} from '../../src/providers/types.js';

/** One scripted model turn. */
export interface MockStep {
    /** Final text returned to the agent. */
    content: string;
    /** Tool calls the model requests on this turn. */
    toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
    /** Optional assertion run against the request before responding. */
    expect?: (messages: ChatMessage[], options: ChatOptions | undefined) => void;
}

/** A recorded provider call. */
export interface MockCall {
    messages: ChatMessage[];
    options: ChatOptions | undefined;
}

export class MockProvider implements LLMProvider {
    readonly name: LLMProviderName;
    readonly calls: MockCall[] = [];
    private readonly steps: MockStep[];

    constructor(steps: Array<MockStep | string>, name: LLMProviderName = 'ollama') {
        this.steps = steps.map(s => (typeof s === 'string' ? { content: s } : s));
        this.name = name;
    }

    /** Text of the first user message sent on call `index`. */
    userPrompt(index: number): string {
        const msg = this.calls[index]?.messages.find(m => m.role === 'user');
        return msg && msg.role === 'user' ? msg.content : '';
    }

    /** Number of scripted steps not yet consumed. */
    get remaining(): number {
        return this.steps.length;
    }

    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
        const step = this.steps.shift();
        if (!step) {
            throw new Error(`MockProvider script exhausted after ${this.calls.length} call(s)`);
        }
        step.expect?.(messages, options);
        this.calls.push({ messages: [...messages], options });

        const toolCalls: ToolCall[] = (step.toolCalls ?? []).map((tc, i) => ({
            name: tc.name,
            input: tc.input,
            callId: `call_${this.calls.length}_${i}`,
        }));
        const completionTokens = Math.ceil(step.content.length / 4);
        return {
            content: step.content,
            model: options?.model ?? 'mock-model',
            usage: { promptTokens: 10, completionTokens, totalTokens: 10 + completionTokens },
            finishReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
            stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
            toolCalls,
        };
    }

    async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk> {
        const response = await this.chat(messages, options);
        yield { content: response.content, done: false };
        if (response.toolCalls.length > 0) {
            yield { content: '', done: false, toolCalls: response.toolCalls };
        }
        yield { content: '', done: true, stopReason: response.stopReason, usage: response.usage };
    }

    async listModels(): Promise<ModelInfo[]> {
        return [{ id: 'mock-model', name: 'Mock Model', provider: this.name }];
    }

    async validateConnection(): Promise<boolean> {
        return true;
    }
}
