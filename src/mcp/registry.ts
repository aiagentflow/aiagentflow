/**
 * MCP server registry — lifecycle management for all configured servers.
 *
 * Spawns servers at workflow start, tears them down at the end, and
 * provides a unified tool catalog across all connected servers.
 *
 * Dependency direction: mcp/registry.ts → mcp/client, mcp/types, utils/logger
 * Used by: workflow runner, agents/base
 */

import { McpClient } from './client.js';
import { logger } from '../utils/logger.js';
import type { McpServersConfig, McpToolDescriptor } from './types.js';
import type { ToolDefinition, ToolCall, ToolResult } from '../providers/types.js';

export interface RegisteredTool {
    definition: ToolDefinition;
    serverName: string;
    /** Roles permitted to call this tool (undefined = all roles). */
    allowedRoles?: string[];
}

export class McpRegistry {
    private clients: Map<string, McpClient> = new Map();
    private toolCatalog: RegisteredTool[] = [];

    /** Start all configured MCP servers and collect their tool catalogs. */
    async start(config: McpServersConfig): Promise<void> {
        for (const [name, serverConfig] of Object.entries(config)) {
            const client = new McpClient(name, serverConfig);
            try {
                await client.start();
                const descriptors = await client.listTools();
                this.clients.set(name, client);

                for (const descriptor of descriptors) {
                    this.toolCatalog.push({
                        definition: mcpDescriptorToToolDef(descriptor),
                        serverName: name,
                        allowedRoles: serverConfig.allowedRoles,
                    });
                }

                logger.info(`MCP server "${name}" started with ${descriptors.length} tool(s)`);
            } catch (err) {
                logger.warn(`MCP server "${name}" failed to start: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    /** Stop all running MCP servers. */
    stop(): void {
        for (const client of this.clients.values()) {
            client.stop();
        }
        this.clients.clear();
        this.toolCatalog = [];
    }

    /** Get all tool definitions, optionally filtered by agent role. */
    getTools(agentRole?: string): ToolDefinition[] {
        return this.toolCatalog
            .filter(t => !agentRole || !t.allowedRoles || t.allowedRoles.includes(agentRole))
            .map(t => t.definition);
    }

    /** Execute a tool call by routing it to the correct server. */
    async executeTool(call: ToolCall): Promise<ToolResult> {
        const registered = this.toolCatalog.find(t => t.definition.name === call.name);
        if (!registered) {
            return { callId: call.callId, content: `Unknown tool: ${call.name}`, isError: true };
        }

        const client = this.clients.get(registered.serverName);
        if (!client || !client.isReady) {
            return { callId: call.callId, content: `MCP server "${registered.serverName}" is not available`, isError: true };
        }

        try {
            logger.debug(`MCP tool call: ${call.name} via server "${registered.serverName}"`);
            const result = await client.callTool(call.name, call.input);
            return { callId: call.callId, content: result.content, isError: result.isError };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`MCP tool "${call.name}" failed: ${msg}`);
            return { callId: call.callId, content: msg, isError: true };
        }
    }

    get isActive(): boolean {
        return this.clients.size > 0;
    }

    get serverNames(): string[] {
        return [...this.clients.keys()];
    }
}

function mcpDescriptorToToolDef(descriptor: McpToolDescriptor): ToolDefinition {
    return {
        name: descriptor.name,
        description: descriptor.description ?? descriptor.name,
        inputSchema: descriptor.inputSchema,
    };
}
