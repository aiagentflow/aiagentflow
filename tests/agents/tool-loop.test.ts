import { describe, it, expect, vi } from 'vitest';
import { BaseAgent, type AgentInput } from '../../src/agents/base.js';
import type { LLMProvider, ToolCall, ToolResult } from '../../src/providers/types.js';
import { MockProvider, type MockStep } from '../helpers/mock-provider.js';

class TestAgent extends BaseAgent {
    protected buildSystemPrompt(): string {
        return 'system';
    }
    protected buildUserPrompt(input: AgentInput): string {
        return input.task;
    }
}

const TOOL = { name: 'echo', description: 'Echo input', inputSchema: { type: 'object' } };

function makeAgent(provider: LLMProvider, onToolCall?: (call: ToolCall) => Promise<ToolResult>) {
    return new TestAgent('coder', provider, { model: 'm', tools: [TOOL], onToolCall });
}

describe('BaseAgent tool loop', () => {
    it('executes requested tools and sends results back until a final answer', async () => {
        const provider = new MockProvider([
            { content: 'thinking', toolCalls: [{ name: 'echo', input: { v: 1 } }, { name: 'echo', input: { v: 2 } }] },
            'final answer',
        ]);
        const onToolCall = vi.fn(async (call: ToolCall): Promise<ToolResult> => ({
            callId: call.callId, content: `echo ${JSON.stringify(call.input)}`,
        }));

        const out = await makeAgent(provider, onToolCall).execute({ task: 'do it' });

        expect(out.content).toBe('final answer');
        expect(onToolCall).toHaveBeenCalledTimes(2);
        expect(provider.calls).toHaveLength(2);

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
        expect(out.tokensUsed).toBe(provider.calls.length * 10 + Math.ceil('thinking'.length / 4) + Math.ceil('final answer'.length / 4));
    });

    it('does not send tools when the agent has no tool handler', async () => {
        const provider = new MockProvider(['plain']);
        await makeAgent(provider).execute({ task: 't' });
        expect(provider.calls[0]!.options?.tools).toBeUndefined();
    });

    it('forces a final answer without tools after the turn limit', async () => {
        const looping: MockStep = { content: '', toolCalls: [{ name: 'echo', input: {} }] };
        const provider = new MockProvider([...Array.from({ length: 10 }, () => looping), 'gave up']);
        const onToolCall = async (call: ToolCall): Promise<ToolResult> => ({ callId: call.callId, content: 'ok' });

        const out = await makeAgent(provider, onToolCall).execute({ task: 't' });

        expect(out.content).toBe('gave up');
        expect(provider.calls).toHaveLength(11);
        expect(provider.calls[10]!.options?.tools).toBeUndefined();
    });
});
