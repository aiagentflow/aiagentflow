/**
 * MockProvider — scripted LLM provider for deterministic workflow tests.
 *
 * Replays a queue of responses in order. Each step may request tool calls,
 * which are executed through `onToolCall` before the step's text is returned.
 * Every call is recorded so tests can assert on prompts and tool results.
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
    ToolResult,
} from '../../src/providers/types.js';

/** One scripted model turn. */
export interface MockStep {
    /** Final text returned to the agent. */
    content: string;
    /** Tool calls the model makes before answering. */
    toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
    /** Optional assertion run against the request before responding. */
    expect?: (messages: ChatMessage[], options: ChatOptions | undefined) => void;
}

/** A recorded provider call. */
export interface MockCall {
    messages: ChatMessage[];
    options: ChatOptions | undefined;
    toolResults: ToolResult[];
}

export class MockProvider implements LLMProvider {
    readonly name: LLMProviderName;
    readonly calls: MockCall[] = [];
    private readonly steps: MockStep[];

    constructor(steps: Array<MockStep | string>, name: LLMProviderName = 'ollama') {
        this.steps = steps.map(s => (typeof s === 'string' ? { content: s } : s));
        this.name = name;
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

        const toolResults: ToolResult[] = [];
        for (const [i, tc] of (step.toolCalls ?? []).entries()) {
            if (!options?.onToolCall) {
                throw new Error(`Step requested tool "${tc.name}" but no onToolCall was provided`);
            }
            const call: ToolCall = { name: tc.name, input: tc.input, callId: `call_${this.calls.length}_${i}` };
            toolResults.push(await options.onToolCall(call));
        }

        this.calls.push({ messages, options, toolResults });

        const completionTokens = Math.ceil(step.content.length / 4);
        return {
            content: step.content,
            model: options?.model ?? 'mock-model',
            usage: { promptTokens: 10, completionTokens, totalTokens: 10 + completionTokens },
            finishReason: 'stop',
        };
    }

    async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk> {
        const response = await this.chat(messages, options);
        yield { content: response.content, done: false };
        yield { content: '', done: true };
    }

    async listModels(): Promise<ModelInfo[]> {
        return [{ id: 'mock-model', name: 'Mock Model', provider: this.name }];
    }

    async validateConnection(): Promise<boolean> {
        return true;
    }
}
