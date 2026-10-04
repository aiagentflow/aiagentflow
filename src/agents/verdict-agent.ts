/**
 * Base class for agents that must end with a structured verdict.
 *
 * Registers the submit_verdict tool, stops the tool loop as soon as a valid
 * verdict is submitted, reminds the model once if it finishes without one,
 * and falls back to a JSON object in the reply text. If none of that yields
 * a valid verdict, execution fails with a clear error.
 *
 * Dependency direction: verdict-agent.ts → agents/base, agents/verdicts, tools/registry, core/errors
 * Used by: reviewer, security, judge agents
 */

import { BaseAgent, type AgentInput, type AgentOptions, type AgentOutput } from './base.js';
import type { StreamCallbacks } from './types.js';
import { AGENT_ROLE_LABELS } from './types.js';
import type { LLMProvider } from '../providers/types.js';
import { ToolRegistry } from '../tools/registry.js';
import { WorkflowError } from '../core/errors.js';
import {
    VERDICT_TOOL_NAME,
    createVerdictTool,
    extractVerdictFromText,
    formatVerdict,
    type Verdict,
    type VerdictRole,
} from './verdicts.js';

export abstract class VerdictAgent extends BaseAgent {
    declare public readonly role: VerdictRole;
    private readonly submitted: { verdict?: Verdict };

    protected constructor(role: VerdictRole, provider: LLMProvider, options: AgentOptions) {
        const submitted: { verdict?: Verdict } = {};
        const tools = new ToolRegistry([
            ...(options.tools ? options.tools.list() : []),
            createVerdictTool(role, verdict => { submitted.verdict = verdict; }),
        ]);
        super(role, provider, { ...options, tools });
        this.submitted = submitted;
    }

    override async execute(input: AgentInput): Promise<AgentOutput> {
        this.submitted.verdict = undefined;
        return this.withVerdict(await super.execute(input));
    }

    override async executeStreaming(input: AgentInput, callbacks?: StreamCallbacks): Promise<AgentOutput> {
        this.submitted.verdict = undefined;
        return this.withVerdict(await super.executeStreaming(input, callbacks));
    }

    protected override isDone(): boolean {
        return this.submitted.verdict !== undefined;
    }

    protected override completionReminder(): string | undefined {
        if (this.submitted.verdict) return undefined;
        return `You have not submitted a verdict. Call the ${VERDICT_TOOL_NAME} tool now with your verdict, summary, and issues. ` +
            'If you cannot call tools, reply with only that JSON object.';
    }

    /** Attach the verdict as metadata; its markdown form becomes the output content. */
    private withVerdict(output: AgentOutput): AgentOutput {
        const verdict = this.submitted.verdict ?? extractVerdictFromText(this.role, output.content);
        if (!verdict) {
            throw new WorkflowError(
                `${AGENT_ROLE_LABELS[this.role]} did not return a valid verdict (expected a ${VERDICT_TOOL_NAME} call or JSON).`,
                { role: this.role, reply: output.content.slice(0, 500) },
            );
        }
        return { ...output, content: formatVerdict(verdict), metadata: { ...output.metadata, verdict } };
    }
}
