import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execaSync } from 'execa';
import { MockProvider, type MockStep } from '../helpers/mock-provider.js';
import { DEFAULT_CONFIG } from '../../src/core/config/defaults.js';
import { setLogLevel, getLogLevel, LogLevel } from '../../src/utils/logger.js';
import { save } from '../../src/memory/store.js';

const holder = vi.hoisted(() => ({ provider: undefined as unknown }));
vi.mock('../../src/providers/registry.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/providers/registry.js')>()),
    createProvider: () => holder.provider,
}));
vi.mock('prompts', () => ({ default: vi.fn(async () => { throw new Error('MCP server must never prompt'); }) }));

const { McpServer } = await import('../../src/mcp/server.js');
const { McpClient } = await import('../../src/mcp/client.js');

type Msg = { id?: number | string | null; method?: string; params?: any; result?: any; error?: { code: number; message: string } };
const verdict = (value: string, issues: object[] = []): MockStep => ({ content: '', toolCalls: [{ name: 'submit_verdict', input: { verdict: value, summary: `Verdict ${value}`, issues } }] });

let dir: string;
const originalLevel = getLogLevel();

function client(maxCostUsd = 5) {
    const out: Msg[] = [];
    const server = new McpServer(line => out.push(JSON.parse(line)), { projectRoot: dir, maxCostUsd });
    let id = 0;
    const call = async (method: string, params: object = {}) => {
        const requestId = ++id;
        await server.receive(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }));
        return out.find(m => m.id === requestId && !m.method)!;
    };
    return { out, call };
}

beforeEach(() => {
    setLogLevel(LogLevel.Silent);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dir = mkdtempSync(join(tmpdir(), 'aiagentflow-mcpserve-'));
    mkdirSync(join(dir, '.aiagentflow'), { recursive: true });
    const config = structuredClone(DEFAULT_CONFIG);
    config.workflow.testCommand = 'node -e "process.exit(0)"';
    writeFileSync(join(dir, '.aiagentflow', 'config.json'), JSON.stringify(config));
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
    const git = (...args: string[]) => execaSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir });
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
});

afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel(originalLevel);
    rmSync(dir, { recursive: true, force: true });
});

describe('MCP protocol', () => {
    it('negotiates the protocol version and lists the tools', async () => {
        const { call } = client();
        expect((await call('initialize', { protocolVersion: '2024-11-05', capabilities: {} })).result).toMatchObject({
            protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'aiagentflow' },
        });
        expect((await call('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion).toBe('2025-06-18');
        const tools = (await call('tools/list')).result.tools.map((t: { name: string }) => t.name);
        expect(tools).toEqual(['aiagentflow_run', 'aiagentflow_review', 'aiagentflow_plan', 'aiagentflow_memory']);
        expect((await call('ping')).result).toEqual({});
    });

    it('rejects unknown tools and missing arguments as protocol errors', async () => {
        const { call } = client();
        expect((await call('tools/call', { name: 'nope', arguments: {} })).error?.code).toBe(-32602);
        expect((await call('tools/call', { name: 'aiagentflow_run', arguments: {} })).error?.message).toBe('"task" is required');
    });
});

describe('MCP tools', () => {
    it('aiagentflow_run runs a workflow headless, reports progress, and returns the result', async () => {
        holder.provider = new MockProvider([
            { content: '', toolCalls: [{ name: 'write_file', input: { path: 'b.ts', content: 'export const b = 2;\n' } }] },
            'Added b.ts.',
            'Tests fine.',
        ]);
        const { out, call } = client();
        const res = await call('tools/call', { name: 'aiagentflow_run', arguments: { task: 'Add b', workflow: 'fast', inplace: true }, _meta: { progressToken: 'p1' } });

        expect(res.result.isError).toBeUndefined();
        const text = res.result.content[0].text;
        expect(text).toContain('Status: passed');
        expect(text).toContain('- b.ts');
        expect(out.filter(m => m.method === 'notifications/progress').map(m => m.params)).toEqual([
            { progressToken: 'p1', progress: 1, message: 'implement passed' },
            { progressToken: 'p1', progress: 2, message: 'test passed' },
        ]);
    });

    it('aiagentflow_run caps the budget and reports failure as a tool error', async () => {
        holder.provider = new MockProvider([]);
        const { call } = client(0.000001);
        const res = await call('tools/call', { name: 'aiagentflow_run', arguments: { task: 'x', workflow: 'fast', inplace: true, max_cost_usd: 100 } });
        expect(res.result.isError).toBe(true);
        expect(res.result.content[0].text).toContain('Status: failed');
    });

    it('aiagentflow_review reviews uncommitted changes and fails at the threshold', async () => {
        writeFileSync(join(dir, 'a.ts'), 'export const a = eval(input);\n');
        holder.provider = new MockProvider([verdict('approve'), verdict('fail', [{ severity: 'critical', message: 'eval of input', file: 'a.ts', line: 1 }])]);
        const { call } = client();
        const res = await call('tools/call', { name: 'aiagentflow_review', arguments: { fail_on: 'high' } });
        expect(res.result.isError).toBe(true);
        expect(res.result.content[0].text).toContain('**[critical]** `a.ts:1` eval of input');
    });

    it('aiagentflow_plan returns the architect plan and aiagentflow_memory reads memory', async () => {
        holder.provider = new MockProvider(['1. Add a cache layer']);
        save(dir, { name: 'no-any', type: 'convention', description: 'Avoid any', body: 'Use unknown.' });
        const { call } = client();
        expect((await call('tools/call', { name: 'aiagentflow_plan', arguments: { request: 'Speed up reads' } })).result.content[0].text).toBe('1. Add a cache layer');
        expect((await call('tools/call', { name: 'aiagentflow_memory', arguments: {} })).result.content[0].text).toBe('- no-any (convention): Avoid any');
        expect((await call('tools/call', { name: 'aiagentflow_memory', arguments: { name: 'no-any' } })).result.content[0].text).toContain('Use unknown.');
        expect((await call('tools/call', { name: 'aiagentflow_memory', arguments: { name: 'missing' } })).result.isError).toBe(true);
    });
});

describe('aiagentflow mcp serve process', () => {
    it('works with an MCP client over stdio', async () => {
        const cli = join(__dirname, '..', '..', 'src', 'cli', 'index.ts');
        const mcp = new McpClient('aiagentflow', { command: 'npx', args: ['tsx', cli, 'mcp', 'serve'] });
        try {
            await mcp.start();
            expect((await mcp.listTools()).map(t => t.name)).toContain('aiagentflow_run');
            const memory = await mcp.callTool('aiagentflow_memory', {});
            expect(memory.content).toContain('No memories saved yet.');
        } finally {
            mcp.stop();
        }
    }, 30_000);
});
