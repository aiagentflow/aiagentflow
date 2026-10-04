/**
 * MCP server mode: expose aiagentflow to other agents (Claude Code, Cursor, ...)
 * as Model Context Protocol tools over stdio.
 *
 * Tools:
 * - aiagentflow_run:    run a workflow on a task (headless, budgeted, worktree by default)
 * - aiagentflow_review: review uncommitted changes, staged changes, or a git range
 * - aiagentflow_plan:   ask the architect for an implementation plan
 * - aiagentflow_memory: list or read the project's agent memory
 *
 * Runs never prompt. When the client sends a progress token, step results are
 * reported as `notifications/progress`.
 *
 * Dependency direction: mcp/server.ts → core/workflow/runner, cli review, agents/factory, memory/store, utils/jsonrpc
 * Used by: cli/commands/mcp.ts
 */

import { createRequire } from 'node:module';
import type { Readable } from 'node:stream';
import { runWorkflow } from '../core/workflow/runner.js';
import { loadConfig } from '../core/config/manager.js';
import { EventBus } from '../core/events.js';
import { createAgent } from '../agents/factory.js';
import { formatVerdict } from '../agents/verdicts.js';
import { PluginRegistry } from '../plugins/registry.js';
import { loadAll } from '../memory/store.js';
import { reviewChanges } from '../cli/commands/review.js';
import { FAIL_ON_VALUES, type FailOn } from '../core/review.js';
import { JsonRpcEndpoint, RpcCode, RpcError, type JsonObject } from '../utils/jsonrpc.js';

/** MCP protocol versions this server accepts; the first is preferred. */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export interface McpServerOptions {
    /** Project the tools work on. */
    projectRoot: string;
    /** Upper bound on the USD cost of one run or review (a tool argument can only lower it). */
    maxCostUsd: number;
}

interface ToolText {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}

const TOOLS = [
    {
        name: 'aiagentflow_run',
        description:
            'Run an aiagentflow workflow on a coding task: agents plan, implement, review, security-check, test, and judge, fixing failures until the gates pass. ' +
            'Runs headless in an isolated git worktree branch by default and reports the result, changed files, verdicts, and cost.',
        inputSchema: {
            type: 'object',
            properties: {
                task: { type: 'string', description: 'What to build or fix' },
                workflow: { type: 'string', description: 'Workflow name: standard (default), fast, review, security-audit, or a project workflow' },
                max_cost_usd: { type: 'number', description: 'Budget for this run in USD' },
                inplace: { type: 'boolean', description: 'Edit the working directory directly instead of a worktree (default false)' },
            },
            required: ['task'],
        },
    },
    {
        name: 'aiagentflow_review',
        description:
            'Review code changes with aiagentflow\'s reviewer and security agents (no edits). Returns a markdown report; the result is an error when a finding reaches fail_on.',
        inputSchema: {
            type: 'object',
            properties: {
                staged: { type: 'boolean', description: 'Review staged changes instead of all uncommitted changes' },
                range: { type: 'string', description: 'Review a git range instead, e.g. main...HEAD' },
                fail_on: { type: 'string', enum: [...FAIL_ON_VALUES], description: 'Severity that counts as failing (default high)' },
                max_cost_usd: { type: 'number', description: 'Budget for this review in USD' },
            },
        },
    },
    {
        name: 'aiagentflow_plan',
        description: 'Ask aiagentflow\'s architect agent to explore the repository and write an implementation plan. Read-only.',
        inputSchema: {
            type: 'object',
            properties: { request: { type: 'string', description: 'What should be planned' } },
            required: ['request'],
        },
    },
    {
        name: 'aiagentflow_memory',
        description: 'List the project knowledge aiagentflow agents have saved (conventions, decisions, gotchas), or read one entry.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Entry to read; omit to list all entries' },
            },
        },
    },
];

export class McpServer {
    private readonly rpc: JsonRpcEndpoint;

    constructor(send: (line: string) => void, private readonly options: McpServerOptions) {
        this.rpc = new JsonRpcEndpoint(send, (method, params) => this.handle(method, params));
    }

    listen(input: Readable): Promise<void> {
        return this.rpc.listen(input);
    }

    receive(line: string): Promise<void> {
        return this.rpc.receive(line);
    }

    private async handle(method: string, params: JsonObject): Promise<unknown> {
        switch (method) {
            case 'initialize': {
                const requested = String(params.protocolVersion ?? '');
                return {
                    protocolVersion: (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0],
                    capabilities: { tools: {} },
                    serverInfo: { name: 'aiagentflow', version: cliVersion() },
                    instructions: 'Use aiagentflow_run for tasks that need planning, review, and tests to pass; aiagentflow_review to check changes before committing.',
                };
            }
            case 'notifications/initialized':
            case 'notifications/cancelled':
                return undefined;
            case 'ping':
                return {};
            case 'tools/list':
                return { tools: TOOLS };
            case 'tools/call':
                return this.callTool(String(params.name ?? ''), (params.arguments as JsonObject | undefined) ?? {}, progressToken(params));
            default:
                throw new RpcError(RpcCode.methodNotFound, `Method not found: ${method}`);
        }
    }

    /** Run a tool. Failures are returned as tool errors (isError), not protocol errors. */
    private async callTool(name: string, args: JsonObject, progress?: string | number): Promise<ToolText> {
        try {
            switch (name) {
                case 'aiagentflow_run':
                    return await this.run(args, progress);
                case 'aiagentflow_review':
                    return await this.review(args);
                case 'aiagentflow_plan':
                    return await this.plan(args);
                case 'aiagentflow_memory':
                    return this.memory(args);
                default:
                    throw new RpcError(RpcCode.invalidParams, `Unknown tool: ${name}`);
            }
        } catch (err) {
            if (err instanceof RpcError) throw err;
            return text(`aiagentflow failed: ${err instanceof Error ? err.message : String(err)}`, true);
        }
    }

    private async run(args: JsonObject, progress?: string | number): Promise<ToolText> {
        const task = requireString(args, 'task');
        const events = new EventBus();
        let step = 0;
        if (progress !== undefined) {
            events.subscribe(event => {
                if (event.type !== 'step.finished') return;
                this.rpc.notify('notifications/progress', { progressToken: progress, progress: ++step, message: `${event.step} ${event.outcome}` });
            });
        }

        const ctx = await runWorkflow({
            projectRoot: this.options.projectRoot,
            task,
            ...(typeof args.workflow === 'string' ? { workflow: args.workflow } : {}),
            headless: true,
            streaming: false,
            showSummary: false,
            ...(args.inplace === true ? { isolation: 'inplace' as const } : {}),
            budget: { maxCostUsd: this.budget(args) },
            events,
        });

        const lines = [
            `Status: ${ctx.status}${ctx.failureReason ? ` (${ctx.failureReason})` : ''}`,
            `Workflow: ${ctx.workflow}, iterations: ${ctx.iteration}/${ctx.maxIterations}`,
            `Cost: $${(ctx.usage?.costUsd ?? 0).toFixed(4)}, tokens: ${ctx.usage?.totalTokens ?? 0}`,
            ctx.generatedFiles.length > 0 ? `Changed files:\n${ctx.generatedFiles.map(f => `- ${f}`).join('\n')}` : 'No files changed.',
            ...Object.values(ctx.verdicts ?? {}).map(v => formatVerdict(v)),
            'With worktree isolation (the default), changes are on a separate branch: merge with `aiagentflow discard --merge <branch>` (see `aiagentflow runs`).',
        ];
        return text(lines.join('\n\n'), ctx.status !== 'passed');
    }

    private async review(args: JsonObject): Promise<ToolText> {
        const failOn = (typeof args.fail_on === 'string' ? args.fail_on : 'high') as FailOn;
        if (!FAIL_ON_VALUES.includes(failOn)) throw new RpcError(RpcCode.invalidParams, `fail_on must be one of ${FAIL_ON_VALUES.join(', ')}`);
        const outcome = await reviewChanges({
            ...(args.staged === true ? { staged: true } : {}),
            ...(typeof args.range === 'string' ? { diff: args.range } : {}),
            failOn,
            output: 'text',
            stream: false,
            maxCost: this.budget(args),
        }, this.options.projectRoot);
        return text(outcome.report ?? `Review did not complete (exit code ${outcome.exitCode}).`, outcome.exitCode !== 0);
    }

    private async plan(args: JsonObject): Promise<ToolText> {
        const request = requireString(args, 'request');
        const config = loadConfig(this.options.projectRoot);
        await new PluginRegistry().load(this.options.projectRoot);
        const architect = createAgent('architect', config, this.options.projectRoot, { memoryDisabled: true });
        const output = await architect.execute({ task: request });
        return text(output.content);
    }

    private memory(args: JsonObject): ToolText {
        const entries = loadAll(this.options.projectRoot);
        if (typeof args.name === 'string') {
            const entry = entries.find(e => e.name === args.name);
            return entry ? text(`# ${entry.name} (${entry.type})\n\n${entry.description}\n\n${entry.body}`) : text(`No memory named "${args.name}".`, true);
        }
        if (entries.length === 0) return text('No memories saved yet.');
        return text(entries.map(e => `- ${e.name} (${e.type}): ${e.description}`).join('\n'));
    }

    /** The smaller of the server cap and the caller's max_cost_usd. */
    private budget(args: JsonObject): number {
        const requested = typeof args.max_cost_usd === 'number' && args.max_cost_usd > 0 ? args.max_cost_usd : Infinity;
        return Math.min(this.options.maxCostUsd, requested);
    }
}

function text(value: string, isError = false): ToolText {
    return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) };
}

function requireString(args: JsonObject, key: string): string {
    const value = args[key];
    if (typeof value !== 'string' || !value.trim()) throw new RpcError(RpcCode.invalidParams, `"${key}" is required`);
    return value;
}

function progressToken(params: JsonObject): string | number | undefined {
    const token = (params._meta as { progressToken?: unknown } | undefined)?.progressToken;
    return typeof token === 'string' || typeof token === 'number' ? token : undefined;
}

function cliVersion(): string {
    try {
        return (createRequire(import.meta.url)('../../package.json') as { version: string }).version;
    } catch {
        return 'unknown';
    }
}
