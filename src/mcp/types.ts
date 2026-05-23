/**
 * MCP (Model Context Protocol) type definitions.
 *
 * Covers the subset of MCP we use: initialize, tools/list, tools/call.
 *
 * Dependency direction: mcp/types.ts → nothing (leaf module)
 * Used by: mcp/client.ts, mcp/registry.ts, mcp/tool-bridge.ts
 */

/** A JSON-RPC 2.0 request. */
export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: Record<string, unknown>;
}

/** A JSON-RPC 2.0 response. */
export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

/** MCP tool descriptor returned by tools/list. */
export interface McpToolDescriptor {
    name: string;
    description?: string;
    inputSchema: {
        type: 'object';
        properties?: Record<string, unknown>;
        required?: string[];
        [key: string]: unknown;
    };
}

/** MCP server configuration (mirrors Claude Desktop / Claude Code schema). */
export interface McpServerConfig {
    /** Command to run the server (e.g. "npx", "python"). */
    command: string;
    /** Arguments passed to the command. */
    args?: string[];
    /** Additional environment variables for the server process. */
    env?: Record<string, string>;
    /** Which agent roles are allowed to call this server's tools. Default: all roles. */
    allowedRoles?: string[];
}

/** Named map of server configs (key = logical server name). */
export type McpServersConfig = Record<string, McpServerConfig>;
