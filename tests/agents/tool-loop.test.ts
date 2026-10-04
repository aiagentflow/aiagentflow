import { describe, it, expect, vi } from 'vitest';
import { BaseAgent, type AgentInput, type AgentOptions } from '../../src/agents/base.js';
import { ToolRegistry, type Tool } from '../../src/tools/registry.js';
import type { LLMProvider, ToolCall } from '../../src/providers/types.js';
import { MockProvider, type MockStep } from '../helpers/mock-provider.js';

class TestAgent extends BaseAgent {
    protected buildSystemPrompt(): string {
        return 'system';
    }
    protected buildUserPrompt(input: AgentInput): string {
        return input.task;
    }
}

function echoTool(execute = vi.fn(async (input: Record<string, unknown>) => `echo ${JSON.stringify(input)}`)) {
    const tool: Tool = { definition: { name: 'echo', description: 'Echo input', inputSchema: { type: 'object' } }, execute };
    return { tool, execute };
}

function makeAgent(provider: LLMProvider, opts: Partial<AgentOptions> = {}) {
    return new TestAgent('coder', provider, { model: 'm', ...opts });
}

describe('BaseAgent tool loop', () => {
    it('executes requested tools and sends results back until a final answer', async () => {
        const provider = new MockProvider([
            { content: 'thinking', toolCalls: [{ name: 'echo', input: { v: 1 } }, { name: 'echo', input: { v: 2 } }] },
            'final answer',
        ]);
        const { tool, execute } = echoTool();

        const out = await makeAgent(provider, { tools: new ToolRegistry([tool]) }).execute({ task: 'do it' });

        expect(out.content).toBe('final answer');
        expect(execute).toHaveBeenCalledTimes(2);
        expect(provider.calls).toHaveLength(2);
        expect(provider.calls[0]!.options?.tools?.map(t => t.name)).toEqual(['echo']);

        const second = provider.calls[1]!.messages;
        expect(second[1]).toMatchObject({ role: 'assistant', content: 'thinking' });
        expect(second[2]).toEqual({
            role: 'tool',
            results: [
                { callId: 'call_1_0', content: 'echo {"v":1}' },
                { callId: 'call_1_1', content: 'echo {"v":2}' },
            ],
        });
        // Tokens are summed across turns
        expect(out.tokensUsed).toBe(20 + Math.ceil('thinking'.length / 4) + Math.ceil('final answer'.length / 4));
    });

    it('does not send tools when the registry is empty or missing', async () => {
        const provider = new MockProvider(['plain', 'plain']);
        await makeAgent(provider).execute({ task: 't' });
        await makeAgent(provider, { tools: new ToolRegistry() }).execute({ task: 't' });
        expect(provider.calls[0]!.options?.tools).toBeUndefined();
        expect(provider.calls[1]!.options?.tools).toBeUndefined();
    });

    it('returns unknown-tool errors to the model instead of throwing', async () => {
        const provider = new MockProvider([{ content: '', toolCalls: [{ name: 'nope', input: {} }] }, 'recovered']);
        const out = await makeAgent(provider, { tools: new ToolRegistry([echoTool().tool]) }).execute({ task: 't' });
        expect(out.content).toBe('recovered');
        expect(provider.calls[1]!.messages[2]).toEqual({ role: 'tool', results: [{ callId: 'call_1_0', content: 'Unknown tool: nope', isError: true }] });
    });

    it('forces a final answer without tools after maxTurns', async () => {
        const looping: MockStep = { content: '', toolCalls: [{ name: 'echo', input: {} }] };
        const provider = new MockProvider([looping, looping, looping, 'gave up']);

        const out = await makeAgent(provider, { tools: new ToolRegistry([echoTool().tool]), maxTurns: 3 }).execute({ task: 't' });

        expect(out.content).toBe('gave up');
        expect(provider.calls).toHaveLength(4);
        expect(provider.calls[3]!.options?.tools).toBeUndefined();
    });

    it('runs the same loop when streaming and reports tool calls', async () => {
        const provider = new MockProvider([
            { content: 'Reading ', toolCalls: [{ name: 'echo', input: { f: 'a' } }] },
            'done.',
        ]);
        const chunks: string[] = [];
        const calls: ToolCall[] = [];
        let completed = '';

        const out = await makeAgent(provider, { tools: new ToolRegistry([echoTool().tool]) }).executeStreaming(
            { task: 't' },
            { onChunk: c => chunks.push(c), onToolCall: c => calls.push(c), onComplete: t => { completed = t; } },
        );

        expect(out.content).toBe('done.');
        expect(chunks).toEqual(['Reading ', 'done.']);
        expect(calls.map(c => c.name)).toEqual(['echo']);
        expect(completed).toBe('done.');
        expect(provider.calls[1]!.messages[2]).toMatchObject({ role: 'tool', results: [{ content: 'echo {"f":"a"}' }] });
    });

    it('sums provider-reported usage across streamed turns', async () => {
        const provider = new MockProvider([{ content: 'a', toolCalls: [{ name: 'echo', input: {} }] }, 'done']);
        const out = await makeAgent(provider, { tools: new ToolRegistry([echoTool().tool]) }).executeStreaming({ task: 't' });
        expect(out.usage).toEqual({ promptTokens: 20, completionTokens: 2, totalTokens: 22 });
        expect(out.tokensUsed).toBe(22);
    });

    it('estimates only when a stream reports no usage', async () => {
        const silent: LLMProvider = {
            name: 'ollama',
            chat: async () => { throw new Error('unused'); },
            async *stream() { yield { content: '12345678', done: false }; yield { content: '', done: true }; },
            listModels: async () => [],
            validateConnection: async () => true,
        };
        const out = await makeAgent(silent).executeStreaming({ task: 't' });
        expect(out.usage).toEqual({ promptTokens: 0, completionTokens: 2, totalTokens: 2 });
    });
});
