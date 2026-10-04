/**
 * Line-delimited JSON-RPC 2.0 endpoint, shared by the ACP and MCP servers.
 *
 * Dispatches incoming requests and notifications to a handler, writes
 * responses, and can send its own requests to the other side (pairing their
 * responses by id). Ids are per direction, so the other side may reuse ours.
 *
 * Dependency direction: jsonrpc.ts → node:readline
 * Used by: acp/server.ts, mcp/server.ts
 */

import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

export type JsonObject = Record<string, unknown>;

export interface JsonRpcMessage {
    jsonrpc: '2.0';
    id?: number | string | null;
    method?: string;
    params?: JsonObject;
    result?: unknown;
    error?: { code: number; message: string };
}

/** Standard JSON-RPC error codes. */
export const RpcCode = {
    parseError: -32700,
    invalidRequest: -32600,
    methodNotFound: -32601,
    invalidParams: -32602,
    internalError: -32603,
} as const;

/** Throw from a handler to answer with a specific error code. */
export class RpcError extends Error {
    constructor(readonly code: number, message: string) {
        super(message);
    }
}

/** Handles a request or notification; the return value is the response result. */
export type RpcHandler = (method: string, params: JsonObject, isNotification: boolean) => Promise<unknown>;

export class JsonRpcEndpoint {
    private readonly pending = new Map<number, (message: JsonRpcMessage) => void>();
    private nextId = 1;

    constructor(
        private readonly send: (line: string) => void,
        private readonly handler: RpcHandler,
    ) {}

    /** Read messages from `input` until it ends; requests are handled concurrently. */
    async listen(input: Readable): Promise<void> {
        const inFlight: Promise<void>[] = [];
        for await (const line of createInterface({ input, crlfDelay: Infinity })) {
            if (line.trim()) inFlight.push(this.receive(line));
        }
        await Promise.all(inFlight);
    }

    /** Handle one incoming line. */
    async receive(line: string): Promise<void> {
        let message: JsonRpcMessage;
        try {
            message = JSON.parse(line) as JsonRpcMessage;
        } catch {
            this.write({ jsonrpc: '2.0', id: null, error: { code: RpcCode.parseError, message: 'Parse error' } });
            return;
        }

        // A response to one of our requests
        if (message.method === undefined && message.id !== undefined && message.id !== null) {
            this.pending.get(Number(message.id))?.(message);
            this.pending.delete(Number(message.id));
            return;
        }

        if (!message.method) {
            this.write({ jsonrpc: '2.0', id: message.id ?? null, error: { code: RpcCode.invalidRequest, message: 'Invalid request' } });
            return;
        }

        const isNotification = message.id === undefined;
        try {
            const result = await this.handler(message.method, message.params ?? {}, isNotification);
            if (!isNotification) this.write({ jsonrpc: '2.0', id: message.id!, result: result ?? {} });
        } catch (err) {
            if (isNotification) return;
            const code = err instanceof RpcError ? err.code : RpcCode.internalError;
            this.write({ jsonrpc: '2.0', id: message.id!, error: { code, message: err instanceof Error ? err.message : String(err) } });
        }
    }

    /** Send a request to the other side and wait for its response. */
    request(method: string, params: JsonObject): Promise<JsonRpcMessage> {
        const id = this.nextId++;
        return new Promise(resolve => {
            this.pending.set(id, resolve);
            this.write({ jsonrpc: '2.0', id, method, params });
        });
    }

    /** Send a notification (no response). */
    notify(method: string, params: JsonObject): void {
        this.write({ jsonrpc: '2.0', method, params });
    }

    private write(message: JsonRpcMessage): void {
        this.send(`${JSON.stringify(message)}\n`);
    }
}

/**
 * Route console and stray stdout writes to stderr, so stdout carries protocol
 * messages only. Returns a writer for the real stdout.
 */
export function claimStdout(): (line: string) => void {
    const writeStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
    return line => {
        writeStdout(line);
    };
}
