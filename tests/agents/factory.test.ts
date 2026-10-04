import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MockProvider } from '../helpers/mock-provider.js';
import { DEFAULT_CONFIG } from '../../src/core/config/defaults.js';
import type { Tool } from '../../src/tools/registry.js';

const holder = vi.hoisted(() => ({ provider: undefined as unknown }));
vi.mock('../../src/providers/registry.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/providers/registry.js')>()),
    createProvider: () => holder.provider,
}));
const { createAgent } = await import('../../src/agents/factory.js');

describe('createAgent tool wiring', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aiagentflow-factory-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('gives eligible roles the remember tool and routes calls to the memory store', async () => {
        const provider = new MockProvider([
            { content: '', toolCalls: [{ name: 'remember', input: { name: 'state-machine', type: 'architecture', description: 'Runner is a state machine', body: 'See runner.ts' } }] },
            'plan',
        ]);
        holder.provider = provider;

        await createAgent('architect', structuredClone(DEFAULT_CONFIG), dir).execute({ task: 't' });

        expect(provider.calls[0]!.options?.tools?.map(t => t.name)).toContain('remember');
        expect(provider.calls[1]!.messages[2]).toMatchObject({ role: 'tool', results: [{ content: expect.stringContaining('saved successfully') }] });
        expect(existsSync(join(dir, '.aiagentflow', 'memory'))).toBe(true);
        expect(readdirSync(join(dir, '.aiagentflow', 'memory')).some(f => f.includes('state-machine'))).toBe(true);
    });

    it('adds extra tools and applies maxTurns from config', async () => {
        const config = structuredClone(DEFAULT_CONFIG);
        config.agents.security = { ...config.agents.security, maxTurns: 1 };
        const extra: Tool = { definition: { name: 'scan', description: 'scan', inputSchema: { type: 'object' } }, execute: async () => 'clean' };
        const provider = new MockProvider([{ content: '', toolCalls: [{ name: 'scan', input: {} }] }, 'PASS']);
        holder.provider = provider;

        const out = await createAgent('security', config, dir, { tools: [extra] }).execute({ task: 't' });

        expect(out.content).toBe('PASS');
        expect(provider.calls[0]!.options?.tools?.map(t => t.name)).toEqual(['scan']);
        // maxTurns 1: second call is the forced final answer without tools
        expect(provider.calls[1]!.options?.tools).toBeUndefined();
    });
});
