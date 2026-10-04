import { describe, it, expect, vi } from 'vitest';
import { MockProvider } from '../helpers/mock-provider.js';

vi.mock('../../src/providers/registry.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/providers/registry.js')>()),
    createProvider: (name: string) => {
        const provider = new MockProvider([], name as never);
        provider.listModels = async () => (name === 'ollama'
            ? [{ id: 'llama3.2:latest', name: 'llama3.2', provider: 'ollama' }]
            : [{ id: 'claude-opus-5-5', name: 'Opus', provider: 'anthropic' }]);
        return provider;
    },
}));
const { checkModels } = await import('../../src/cli/commands/doctor.js');

describe('doctor model checks', () => {
    it('warns about models a reachable provider does not list and models without pricing', async () => {
        const warnings = await checkModels({
            providers: {} as never,
            agents: {
                architect: { provider: 'anthropic', model: 'claude-opus-5-5' },
                coder: { provider: 'anthropic', model: 'claude-3-opus-20240229' },
                tester: { provider: 'ollama', model: 'qwen3:8b' },
                judge: { provider: 'groq', model: 'some-model' },
            },
        }, ['anthropic', 'ollama']);

        expect(warnings).toEqual([
            'coder: anthropic does not list "claude-3-opus-20240229". It may be retired or misspelled; the default is "claude-opus-5-5".',
            'coder: no pricing data for "claude-3-opus-20240229"; cost estimates will show "-".',
            'tester: "qwen3:8b" is not installed in Ollama. Run: ollama pull qwen3:8b',
            // groq is unreachable, so only the pricing warning applies
            'judge: no pricing data for "some-model"; cost estimates will show "-".',
        ]);
    });
});
