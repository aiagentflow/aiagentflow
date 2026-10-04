import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';
import { MockProvider, type MockStep } from '../helpers/mock-provider.js';
import { DEFAULT_CONFIG } from '../../src/core/config/defaults.js';
import { setLogLevel, getLogLevel, LogLevel } from '../../src/utils/logger.js';

const holder = vi.hoisted(() => ({ provider: undefined as unknown }));
vi.mock('../../src/providers/registry.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/providers/registry.js')>()),
    createProvider: () => holder.provider,
}));
vi.mock('prompts', () => ({ default: vi.fn(async () => { throw new Error('ACP must never prompt in the terminal'); }) }));

const { AcpServer, promptText, toolKind } = await import('../../src/acp/server.js');

type Msg = { jsonrpc: string; id?: number | string | null; method?: string; params?: any; result?: any; error?: { code: number; message: string } };

/** An in-memory editor: sends requests and records everything the server writes. */
function editor(options = {}) {
    const out: Msg[] = [];
    const server = new AcpServer(line => out.push(JSON.parse(line)), options);
    let id = 100;
    const call = async (method: string, params: object) => {
        const requestId = ++id;
        await server.receive(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }));
        return out.find(m => m.id === requestId && !m.method)!;
    };
    return { server, out, call };
}

const verdict = (value: string): MockStep => ({ content: '', toolCalls: [{ name: 'submit_verdict', input: { verdict: value, summary: `Verdict ${value}`, issues: [] } }] });

describe('ACP protocol', () => {
    it('initializes with protocol version 1 and agent info', async () => {
        const { call } = editor();
        const res = await call('initialize', { protocolVersion: 1, clientCapabilities: {} });
        expect(res.result).toMatchObject({
            protocolVersion: 1,
            agentCapabilities: { loadSession: false, promptCapabilities: { embeddedContext: true } },
            authMethods: [],
            agentInfo: { name: 'aiagentflow' },
        });
    });

    it('rejects relative cwd, unknown methods, unknown sessions, and bad JSON', async () => {
        const { server, out, call } = editor();
        expect((await call('session/new', { cwd: 'relative', mcpServers: [] })).error?.code).toBe(-32602);
        expect((await call('nope', {})).error?.code).toBe(-32601);
        expect((await call('session/prompt', { sessionId: 'missing', prompt: [] })).error?.message).toContain('Unknown session');
        await server.receive('{not json');
        expect(out.at(-1)?.error?.code).toBe(-32700);
    });

    it('extracts prompt text from text and embedded resources', () => {
        expect(promptText([
            { type: 'text', text: 'Fix the bug' },
            { type: 'resource', resource: { uri: 'file:///p/a.ts', text: 'const a = 1;' } },
        ])).toBe('Fix the bug\n\n## file:///p/a.ts\n\nconst a = 1;');
        expect(toolKind('edit_file')).toBe('edit');
        expect(toolKind('run_command')).toBe('execute');
        expect(toolKind('grep')).toBe('search');
    });
});

describe('ACP prompt turns', () => {
    let dir: string;
    const originalLevel = getLogLevel();

    beforeEach(() => {
        setLogLevel(LogLevel.Silent);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        dir = mkdtempSync(join(tmpdir(), 'aiagentflow-acp-'));
        mkdirSync(join(dir, '.aiagentflow'), { recursive: true });
        const config = structuredClone(DEFAULT_CONFIG);
        config.workflow.testCommand = 'node -e "process.exit(0)"';
        writeFileSync(join(dir, '.aiagentflow', 'config.json'), JSON.stringify(config));
    });
    afterEach(() => {
        vi.restoreAllMocks();
        setLogLevel(originalLevel);
        rmSync(dir, { recursive: true, force: true });
    });

    it('runs the workflow, streams plan, tool calls with diffs, and verdicts, and asks the editor about commands', async () => {
        holder.provider = new MockProvider([
            'Plan: add src/app.ts',
            { content: '', toolCalls: [{ name: 'write_file', input: { path: 'src/app.ts', content: 'export const app = 1;\n' } }] },
            { content: '', toolCalls: [{ name: 'run_command', input: { command: 'touch approved.txt' } }] },
            'Created src/app.ts.',
            verdict('approve'), verdict('pass'),
            'Tests are fine.',
            verdict('pass'),
        ]);
        const { server, out, call } = editor({ workflow: 'standard' });
        const { result: { sessionId } } = await call('session/new', { cwd: dir, mcpServers: [] });

        // The editor approves the command as soon as it is asked
        const turn = server.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: 'Build the app' }] } }));
        await vi.waitFor(() => expect(out.some(m => m.method === 'session/request_permission')).toBe(true));
        const ask = out.find(m => m.method === 'session/request_permission')!;
        expect(ask.params.options.map((o: { kind: string }) => o.kind)).toEqual(['allow_once', 'allow_always', 'reject_once']);
        await server.receive(JSON.stringify({ jsonrpc: '2.0', id: ask.id, result: { outcome: { outcome: 'selected', optionId: 'allow_once' } } }));
        await turn;

        expect(out.find(m => m.id === 1 && !m.method)?.result).toEqual({ stopReason: 'end_turn' });
        expect(existsSync(join(dir, 'approved.txt'))).toBe(true);
        expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf-8')).toContain('app = 1');

        const updates = out.filter(m => m.method === 'session/update').map(m => m.params.update);
        const edit = updates.find(u => u.sessionUpdate === 'tool_call' && u.kind === 'edit');
        expect(edit).toMatchObject({
            status: 'in_progress',
            locations: [{ path: join(dir, 'src/app.ts') }],
            content: [{ type: 'diff', path: join(dir, 'src/app.ts'), oldText: null, newText: 'export const app = 1;\n' }],
        });
        expect(updates).toContainEqual(expect.objectContaining({ sessionUpdate: 'tool_call_update', toolCallId: edit.toolCallId, status: 'completed' }));
        expect(updates.some(u => u.sessionUpdate === 'agent_message_chunk' && u.content.text.includes('**Verdict:** APPROVE'))).toBe(true);
        const finalPlan = updates.filter(u => u.sessionUpdate === 'plan').at(-1);
        expect(finalPlan.entries.every((e: { status: string }) => e.status === 'completed')).toBe(true);
        expect(updates.at(-1)).toMatchObject({ sessionUpdate: 'agent_message_chunk', content: { text: 'Done: all steps passed.\n' } });
    });

    it('stops at the next step when the editor cancels', async () => {
        holder.provider = new MockProvider([
            'Plan',
            { content: '', toolCalls: [{ name: 'run_command', input: { command: 'touch x.txt' } }] },
            'Coded.',
        ]);
        const { server, out, call } = editor();
        const { result: { sessionId } } = await call('session/new', { cwd: dir, mcpServers: [] });

        const turn = server.receive(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: 'Build' }] } }));
        await vi.waitFor(() => expect(out.some(m => m.method === 'session/request_permission')).toBe(true));
        const ask = out.find(m => m.method === 'session/request_permission')!;
        await server.receive(JSON.stringify({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } }));
        await server.receive(JSON.stringify({ jsonrpc: '2.0', id: ask.id, result: { outcome: { outcome: 'cancelled' } } }));
        await turn;

        expect(out.find(m => m.id === 2 && !m.method)?.result).toEqual({ stopReason: 'cancelled' });
        expect(existsSync(join(dir, 'x.txt'))).toBe(false);
    });
});

describe('aiagentflow acp process', () => {
    it('speaks line-delimited JSON-RPC on stdout and keeps logs off it', async () => {
        const cli = join(__dirname, '..', '..', 'src', 'cli', 'index.ts');
        const child = execa('npx', ['tsx', cli, 'acp'], { input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } })}\n`, reject: false, timeout: 20_000 });
        const { stdout } = await child;
        const lines = stdout.trim().split('\n');
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0]!)).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } });
    }, 30_000);
});
