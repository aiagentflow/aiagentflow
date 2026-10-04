/**
 * Tool registry — the single place agents look up and execute tools.
 *
 * Every tool source (MCP servers, the memory `remember` tool, built-in repo
 * tools) contributes `Tool` objects. The agent runtime only talks to the
 * registry, so routing, unknown-tool handling, and error capture live here.
 *
 * Dependency direction: tools/registry.ts → providers/types.ts, utils/logger
 * Used by: agents/base.ts, agents/factory.ts, mcp/registry.ts
 */

import type { ToolCall, ToolDefinition, ToolResult } from '../providers/types.js';
import { logger } from '../utils/logger.js';

/** What a tool returns: plain text, or text flagged as an error. */
export type ToolOutput = string | { content: string; isError?: boolean };

/** A tool an agent can call. */
export interface Tool {
    readonly definition: ToolDefinition;
    execute(input: Record<string, unknown>): Promise<ToolOutput>;
}

export class ToolRegistry {
    private readonly tools = new Map<string, Tool>();

    constructor(tools: Iterable<Tool> = []) {
        for (const tool of tools) this.register(tool);
    }

    /**
     * Add a tool.
     * @throws {Error} if a tool with the same name is already registered
     */
    register(tool: Tool): this {
        const { name } = tool.definition;
        if (this.tools.has(name)) {
            throw new Error(`Tool "${name}" is already registered`);
        }
        this.tools.set(name, tool);
        return this;
    }

    has(name: string): boolean {
        return this.tools.has(name);
    }

    get size(): number {
        return this.tools.size;
    }

    /** Definitions to send to the model. */
    get definitions(): ToolDefinition[] {
        return [...this.tools.values()].map(t => t.definition);
    }

    /**
     * Execute a tool call. Never throws: unknown tools and handler failures
     * come back as error results so the model can recover.
     */
    async execute(call: ToolCall): Promise<ToolResult> {
        const tool = this.tools.get(call.name);
        if (!tool) {
            return { callId: call.callId, content: `Unknown tool: ${call.name}`, isError: true };
        }

        try {
            const output = await tool.execute(call.input);
            return typeof output === 'string'
                ? { callId: call.callId, content: output }
                : { callId: call.callId, content: output.content, ...(output.isError ? { isError: true } : {}) };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.debug(`Tool "${call.name}" threw: ${message}`);
            return { callId: call.callId, content: `Error: ${message}`, isError: true };
        }
    }
}
