/**
 * Agent Client Protocol (ACP v1) server: lets editors such as Zed drive
 * aiagentflow workflows.
 *
 * Transport: JSON-RPC 2.0, one message per line, on stdin/stdout.
 *
 * - `session/new` remembers the working directory.
 * - `session/prompt` runs a workflow on the prompt text. Run events become
 *   `session/update` notifications: a plan with one entry per step, tool calls
 *   (with diffs for file edits), verdicts, and step results.
 * - Commands that need approval are sent to the editor as
 *   `session/request_permission`.
 * - `session/cancel` stops the run before its next step.
 *
 * Runs edit the working directory in place (the editor shows the changes), and
 * never prompt in the terminal.
 *
 * Dependency direction: acp/server.ts → core/workflow/runner, core/events, agents/verdicts, workflow-loader
 * Used by: cli/commands/acp.ts
 */

import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { isAbsolute, join } from 'node:path';
import type { Readable } from 'node:stream';
import { runWorkflow } from '../core/workflow/runner.js';
import { getWorkflow } from '../core/workflow/workflow-loader.js';
import { firstStep, nextStep, stepRunner, type WorkflowDefinition } from '../core/workflow/definition.js';
import { EventBus, type TimedRunEvent } from '../core/events.js';
import { formatVerdict } from '../agents/verdicts.js';
import type { ConfirmAnswer } from '../tools/command.js';

/** ACP protocol version implemented here. */
export const ACP_PROTOCOL_VERSION = 1;

type Json = Record<string, unknown>;

interface JsonRpcMessage {
    jsonrpc: '2.0';
    id?: number | string | null;
    method?: string;
    params?: Json;
    result?: unknown;
    error?: { code: number; message: string };
}

interface Session {
    id: string;
    cwd: string;
    /** Aborts the running prompt turn, if any. */
    abort?: AbortController;
}

/** JSON-RPC error codes. */
const RPC = { parseError: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internalError: -32603 } as const;

class RpcError extends Error {
    constructor(readonly code: number, message: string) {
        super(message);
    }
}

export interface AcpServerOptions {
    /** Workflow for every prompt (default: "standard"). */
    workflow?: string;
}

export class AcpServer {
    private readonly sessions = new Map<string, Session>();
    private readonly pending = new Map<number, (message: JsonRpcMessage) => void>();
    private nextRequestId = 1;
    private nextSessionId = 1;
    /** tool.called and tool.result for one call arrive back to back, so a counter pairs them. */
    private toolCalls = 0;

    constructor(
        private readonly send: (line: string) => void,
        private readonly options: AcpServerOptions = {},
    ) {}

    /** Read messages from `input` until it ends. */
    async listen(input: Readable): Promise<void> {
        const lines = createInterface({ input, crlfDelay: Infinity });
        const inFlight: Promise<void>[] = [];
        for await (const line of lines) {
            if (!line.trim()) continue;
            // Prompt turns run concurrently with the messages that answer their permission requests
            inFlight.push(this.receive(line));
        }
        await Promise.all(inFlight);
    }

    /** Handle one incoming line. */
    async receive(line: string): Promise<void> {
        let message: JsonRpcMessage;
        try {
            message = JSON.parse(line) as JsonRpcMessage;
        } catch {
            this.write({ jsonrpc: '2.0', id: null, error: { code: RPC.parseError, message: 'Parse error' } });
            return;
        }

        // A response to one of our requests (session/request_permission)
        if (message.method === undefined && message.id !== undefined && message.id !== null) {
            this.pending.get(Number(message.id))?.(message);
            this.pending.delete(Number(message.id));
            return;
        }

        if (!message.method) {
            this.write({ jsonrpc: '2.0', id: message.id ?? null, error: { code: RPC.invalidRequest, message: 'Invalid request' } });
            return;
        }

        const isNotification = message.id === undefined;
        try {
            const result = await this.handle(message.method, message.params ?? {});
            if (!isNotification) this.write({ jsonrpc: '2.0', id: message.id!, result: result ?? {} });
        } catch (err) {
            if (isNotification) return;
            const code = err instanceof RpcError ? err.code : RPC.internalError;
            this.write({ jsonrpc: '2.0', id: message.id!, error: { code, message: err instanceof Error ? err.message : String(err) } });
        }
    }

    private async handle(method: string, params: Json): Promise<unknown> {
        switch (method) {
            case 'initialize':
                return {
                    protocolVersion: Math.min(Number(params.protocolVersion ?? ACP_PROTOCOL_VERSION), ACP_PROTOCOL_VERSION),
                    agentCapabilities: {
                        loadSession: false,
                        promptCapabilities: { image: false, audio: false, embeddedContext: true },
                    },
                    authMethods: [],
                    agentInfo: { name: 'aiagentflow', title: 'aiagentflow', version: cliVersion() },
                };

            case 'authenticate':
                return {};

            case 'session/new': {
                const cwd = params.cwd;
                if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new RpcError(RPC.invalidParams, 'cwd must be an absolute path');
                const id = `aiagentflow-${this.nextSessionId++}`;
                this.sessions.set(id, { id, cwd });
                return { sessionId: id };
            }

            case 'session/prompt':
                return this.prompt(this.session(params.sessionId), params.prompt);

            case 'session/cancel':
                this.sessions.get(String(params.sessionId))?.abort?.abort();
                return undefined;

            default:
                throw new RpcError(RPC.methodNotFound, `Method not found: ${method}`);
        }
    }

    private session(id: unknown): Session {
        const session = this.sessions.get(String(id));
        if (!session) throw new RpcError(RPC.invalidParams, `Unknown session: ${String(id)}`);
        return session;
    }

    /** Run a workflow for one prompt turn and stream its progress. */
    private async prompt(session: Session, prompt: unknown): Promise<{ stopReason: string }> {
        const task = promptText(prompt);
        if (!task) throw new RpcError(RPC.invalidParams, 'prompt has no text');
        if (session.abort) throw new RpcError(RPC.invalidRequest, 'A prompt is already running in this session');

        const workflow = getWorkflow(session.cwd, this.options.workflow).definition;
        const plan = new PlanTracker(workflow);
        const events = new EventBus();
        events.subscribe(event => this.forward(session, event, plan));

        session.abort = new AbortController();
        try {
            this.update(session, { sessionUpdate: 'plan', entries: plan.entries() });
            const ctx = await runWorkflow({
                projectRoot: session.cwd,
                task,
                workflow: workflow.name,
                auto: true,
                streaming: false,
                isolation: 'inplace',
                showSummary: false,
                events,
                signal: session.abort.signal,
                confirmCommand: command => this.requestPermission(session, command),
            });
            if (session.abort.signal.aborted) return { stopReason: 'cancelled' };
            this.say(session, ctx.status === 'passed'
                ? 'Done: all steps passed.'
                : `Stopped: ${ctx.failureReason ?? 'the workflow failed'}.`);
            return { stopReason: 'end_turn' };
        } finally {
            session.abort = undefined;
        }
    }

    /** Map a run event to session/update notifications. */
    private forward(session: Session, event: TimedRunEvent, plan: PlanTracker): void {
        switch (event.type) {
            case 'step.started':
                plan.start(event.step);
                this.update(session, { sessionUpdate: 'plan', entries: plan.entries() });
                break;

            case 'tool.called': {
                const path = typeof event.input.path === 'string' ? join(session.cwd, event.input.path) : undefined;
                this.update(session, {
                    sessionUpdate: 'tool_call',
                    toolCallId: `tool-${++this.toolCalls}`,
                    title: toolTitle(event.tool, event.input),
                    kind: toolKind(event.tool),
                    status: 'in_progress',
                    rawInput: event.input,
                    ...(path ? { locations: [{ path }] } : {}),
                    ...(path ? { content: diffContent(event.tool, event.input, path) } : {}),
                });
                break;
            }

            case 'tool.result':
                this.update(session, { sessionUpdate: 'tool_call_update', toolCallId: `tool-${this.toolCalls}`, status: event.isError ? 'failed' : 'completed' });
                break;

            case 'verdict':
                this.say(session, formatVerdict(event.verdict));
                break;

            case 'check.finished':
                this.say(session, `${event.check} ${event.passed ? 'passed' : 'failed'}`);
                break;

            case 'step.finished':
                plan.finish(event.step, event.outcome);
                this.update(session, { sessionUpdate: 'plan', entries: plan.entries() });
                break;

            default:
                break;
        }
    }

    /** Ask the editor whether a command may run. Anything but an allow counts as no. */
    private async requestPermission(session: Session, command: string): Promise<ConfirmAnswer> {
        const response = await this.request('session/request_permission', {
            sessionId: session.id,
            toolCall: { toolCallId: `cmd-${this.nextRequestId}`, title: `Run: ${command}`, kind: 'execute', status: 'pending', rawInput: { command } },
            options: [
                { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
                { optionId: 'allow_always', name: 'Allow for this run', kind: 'allow_always' },
                { optionId: 'reject_once', name: 'Deny', kind: 'reject_once' },
            ],
        });
        const outcome = (response.result as { outcome?: { outcome?: string; optionId?: string } } | undefined)?.outcome;
        if (outcome?.outcome !== 'selected') return 'no';
        return outcome.optionId === 'allow_always' ? 'always' : outcome.optionId === 'allow_once' ? 'yes' : 'no';
    }

    private request(method: string, params: Json): Promise<JsonRpcMessage> {
        const id = this.nextRequestId++;
        return new Promise(resolve => {
            this.pending.set(id, resolve);
            this.write({ jsonrpc: '2.0', id, method, params });
        });
    }

    private update(session: Session, update: Json): void {
        this.write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: session.id, update } });
    }

    private say(session: Session, text: string): void {
        this.update(session, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${text}\n` } });
    }

    private write(message: JsonRpcMessage): void {
        this.send(`${JSON.stringify(message)}\n`);
    }
}

/** Plan entries: one per main-path step, plus on-fail steps once they run. */
class PlanTracker {
    private readonly status = new Map<string, 'pending' | 'in_progress' | 'completed'>();
    private readonly labels = new Map<string, string>();

    constructor(workflow: WorkflowDefinition) {
        for (const step of workflow.steps) this.labels.set(step.id, `${step.id} (${stepRunner(step)})`);
        for (let s: WorkflowDefinition['steps'][number] | undefined = firstStep(workflow); s; s = nextStep(workflow, s)) {
            this.status.set(s.id, 'pending');
        }
    }

    start(step: string): void {
        this.status.set(step, 'in_progress');
    }

    /** A failed step goes back to pending: it will run again after the fix. */
    finish(step: string, outcome: string): void {
        this.status.set(step, outcome === 'passed' ? 'completed' : 'pending');
    }

    entries(): Json[] {
        return [...this.status].map(([step, status]) => ({ content: this.labels.get(step) ?? step, priority: 'medium', status }));
    }
}

/** Text of a prompt: text blocks plus embedded text resources. */
export function promptText(prompt: unknown): string {
    if (!Array.isArray(prompt)) return '';
    return prompt.map(block => {
        if (block?.type === 'text' && typeof block.text === 'string') return block.text;
        if (block?.type === 'resource' && typeof block.resource?.text === 'string') {
            return `\n## ${block.resource.uri ?? 'Attached file'}\n\n${block.resource.text}`;
        }
        if (block?.type === 'resource_link' && typeof block.uri === 'string') return `\n(See ${block.uri})`;
        return '';
    }).join('\n').trim();
}

/** ACP tool kinds for the built-in tools. */
export function toolKind(tool: string): string {
    switch (tool) {
        case 'read_file': return 'read';
        case 'list_dir':
        case 'grep': return 'search';
        case 'edit_file':
        case 'write_file': return 'edit';
        case 'run_command': return 'execute';
        case 'submit_verdict':
        case 'remember': return 'think';
        default: return 'other';
    }
}

function toolTitle(tool: string, input: Record<string, unknown>): string {
    const hint = input.path ?? input.command ?? input.pattern;
    return typeof hint === 'string' ? `${tool} ${hint}` : tool;
}

/** Edits shown as diffs: the replaced snippet for edit_file, the whole file for write_file. */
function diffContent(tool: string, input: Record<string, unknown>, path: string): Json[] {
    if (tool === 'edit_file' && typeof input.new_string === 'string') {
        return [{ type: 'diff', path, oldText: typeof input.old_string === 'string' ? input.old_string : null, newText: input.new_string }];
    }
    if (tool === 'write_file' && typeof input.content === 'string') {
        return [{ type: 'diff', path, oldText: null, newText: input.content }];
    }
    return [];
}

function cliVersion(): string {
    try {
        return (createRequire(import.meta.url)('../../package.json') as { version: string }).version;
    } catch {
        return 'unknown';
    }
}
