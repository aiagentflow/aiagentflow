/**
 * Tests for MCP registry tool catalog and routing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpRegistry } from '../../src/mcp/registry.js';

vi.mock('../../src/mcp/client.js', () => ({
    McpClient: vi.fn().mockImplementation((name: string) => ({
        serverName: name,
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
        isReady: true,
        listTools: vi.fn().mockResolvedValue([
            {
                name: 'read_file',
                description: 'Read a file from the filesystem',
                inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            },
            {
                name: 'write_file',
                description: 'Write content to a file',
                inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
            },
        ]),
        callTool: vi.fn().mockResolvedValue({ content: 'file contents here', isError: false }),
    })),
}));

describe('McpRegistry', () => {
    let registry: McpRegistry;

    beforeEach(() => {
        registry = new McpRegistry();
    });

    it('starts servers and builds tool catalog', async () => {
        await registry.start({ filesystem: { command: 'npx', args: ['@modelcontextprotocol/server-filesystem'] } });
        expect(registry.isActive).toBe(true);
        expect(registry.serverNames).toContain('filesystem');
    });

    it('returns all tools when no role filter', async () => {
        await registry.start({ filesystem: { command: 'npx', args: [] } });
        const tools = registry.getTools();
        expect(tools).toHaveLength(2);
        expect(tools.map(t => t.name)).toContain('read_file');
    });

    it('filters tools by allowed role', async () => {
        await registry.start({
            filesystem: { command: 'npx', args: [], allowedRoles: ['coder'] },
        });
        expect(registry.getTools('coder')).toHaveLength(2);
        expect(registry.getTools('reviewer')).toHaveLength(0);
    });

    it('executes a tool call and returns result', async () => {
        await registry.start({ filesystem: { command: 'npx', args: [] } });
        const result = await registry.executeTool({
            name: 'read_file',
            input: { path: '/tmp/test.txt' },
            callId: 'call-1',
        });
        expect(result.callId).toBe('call-1');
        expect(result.content).toBe('file contents here');
        expect(result.isError).toBeFalsy();
    });

    it('returns error result for unknown tool', async () => {
        await registry.start({ filesystem: { command: 'npx', args: [] } });
        const result = await registry.executeTool({
            name: 'nonexistent_tool',
            input: {},
            callId: 'call-2',
        });
        expect(result.isError).toBe(true);
        expect(result.content).toContain('Unknown tool');
    });

    it('stops all clients on stop()', async () => {
        const { McpClient } = await import('../../src/mcp/client.js');
        await registry.start({ filesystem: { command: 'npx', args: [] } });
        registry.stop();
        expect(registry.isActive).toBe(false);
        const results = vi.mocked(McpClient).mock.results;
        const instance = results[results.length - 1]?.value;
        expect(instance?.stop).toHaveBeenCalled();
    });
});
