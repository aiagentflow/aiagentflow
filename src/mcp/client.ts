/**
 * MCP stdio client — JSON-RPC 2.0 over child process stdin/stdout.
 *
 * Spawns a single MCP server process, exchanges JSON-RPC messages,
 * and exposes a typed API for the operations we need.
 *
 * Dependency direction: mcp/client.ts → mcp/types, node:child_process, utils/logger
 * Used by: mcp/registry.ts
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger.js';
import type { JsonRpcRequest, JsonRpcResponse, McpToolDescriptor, McpServerConfig } from './types.js';

export class McpClient extends EventEmitter {
    private process: ChildProcess | null = null;
    private buffer = '';
    private pendingRequests = new Map<number, {
        resolve: (result: unknown) => void;
        reject: (err: Error) => void;
    }>();
    private nextId = 1;
    private ready = false;

    constructor(
        public readonly serverName: string,
        private readonly config: McpServerConfig,
    ) {
        super();
    }

    /** Start the server process and complete the MCP initialize handshake. */
    async start(): Promise<void> {
        const env = { ...process.env, ...(this.config.env ?? {}) } as Record<string, string>;

        this.process = spawn(this.config.command, this.config.args ?? [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env,
        });

        this.process.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
        this.process.stderr?.on('data', (chunk: Buffer) => {
            logger.debug(`[MCP:${this.serverName}] ${chunk.toString().trim()}`);
        });
        this.process.on('exit', (code) => {
            logger.debug(`[MCP:${this.serverName}] exited with code ${code}`);
            this.ready = false;
            this.rejectAllPending(new Error(`MCP server "${this.serverName}" exited`));
        });

        // MCP initialize handshake
        await this.request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            clientInfo: { name: 'aiagentflow', version: '1.0.0' },
        });

        // Send initialized notification (no response expected)
        this.send({ jsonrpc: '2.0', id: 0, method: 'notifications/initialized' });
        this.ready = true;
    }

    /** Stop the server process. */
    stop(): void {
        this.ready = false;
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this.rejectAllPending(new Error(`MCP server "${this.serverName}" stopped`));
    }

    /** List all tools the server exposes. */
    async listTools(): Promise<McpToolDescriptor[]> {
        const result = await this.request('tools/list', {}) as { tools?: McpToolDescriptor[] };
        return result.tools ?? [];
    }

    /** Call a tool by name with the given input. Returns the tool's output as a string. */
    async callTool(name: string, input: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
        const result = await this.request('tools/call', { name, arguments: input }) as {
            content?: Array<{ type: string; text?: string }>;
            isError?: boolean;
        };

        const text = (result.content ?? [])
            .filter(block => block.type === 'text')
            .map(block => block.text ?? '')
            .join('\n');

        return { content: text, isError: result.isError };
    }

    get isReady(): boolean {
        return this.ready;
    }

    // ── Private ──

    private send(msg: Record<string, unknown> | JsonRpcRequest): void {
        if (!this.process?.stdin) {
            throw new Error(`MCP server "${this.serverName}" is not running`);
        }
        this.process.stdin.write(JSON.stringify(msg) + '\n');
    }

    private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
        const id = this.nextId++;
        const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

        return new Promise<unknown>((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            try {
                this.send(req);
            } catch (err) {
                this.pendingRequests.delete(id);
                reject(err);
            }

            // Per-request timeout
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`MCP request "${method}" timed out`));
                }
            }, 30_000);
        });
    }

    private onData(chunk: Buffer): void {
        this.buffer += chunk.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const msg = JSON.parse(trimmed) as JsonRpcResponse;
                const pending = this.pendingRequests.get(msg.id);
                if (!pending) continue;
                this.pendingRequests.delete(msg.id);

                if (msg.error) {
                    pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
                } else {
                    pending.resolve(msg.result);
                }
            } catch {
                // Skip non-JSON lines (server debug output on stdout)
            }
        }
    }

    private rejectAllPending(err: Error): void {
        for (const { reject } of this.pendingRequests.values()) {
            reject(err);
        }
        this.pendingRequests.clear();
    }
}
