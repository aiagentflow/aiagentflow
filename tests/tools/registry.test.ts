import { describe, it, expect } from 'vitest';
import { ToolRegistry, type Tool } from '../../src/tools/registry.js';

const tool = (name: string, execute: Tool['execute']): Tool => ({
    definition: { name, description: name, inputSchema: { type: 'object' } },
    execute,
});

describe('ToolRegistry', () => {
    it('lists definitions and executes by name', async () => {
        const reg = new ToolRegistry([tool('a', async () => 'A'), tool('b', async (i) => ({ content: `B${String(i.x)}`, isError: true }))]);
        expect(reg.definitions.map(d => d.name)).toEqual(['a', 'b']);
        expect(await reg.execute({ name: 'a', input: {}, callId: '1' })).toEqual({ callId: '1', content: 'A' });
        expect(await reg.execute({ name: 'b', input: { x: 2 }, callId: '2' })).toEqual({ callId: '2', content: 'B2', isError: true });
    });

    it('rejects duplicate names', () => {
        const reg = new ToolRegistry([tool('a', async () => '')]);
        expect(() => reg.register(tool('a', async () => ''))).toThrow('already registered');
    });

    it('turns unknown tools and thrown errors into error results', async () => {
        const reg = new ToolRegistry([tool('boom', async () => { throw new Error('bad input'); })]);
        expect(await reg.execute({ name: 'missing', input: {}, callId: 'x' })).toEqual({ callId: 'x', content: 'Unknown tool: missing', isError: true });
        expect(await reg.execute({ name: 'boom', input: {}, callId: 'y' })).toEqual({ callId: 'y', content: 'Error: bad input', isError: true });
    });
});
