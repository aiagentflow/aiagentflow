/**
 * Workflow executor — runs a workflow definition step by step.
 *
 * For each step: run the step's agent, apply its output to the run context,
 * then run the step's checks and verdict gate. A failed check or gate routes
 * to the step's `onFail` target and uses one fix iteration; otherwise the
 * run continues to `next`. The run passes when the last step succeeds.
 *
 * Dependency direction: executor.ts → engine, definition, agents, tools, checks
 * Used by: workflow runner
 */

import ora from 'ora';
import { createAgent } from '../../agents/factory.js';
import type { AgentInput, AgentOutput } from '../../agents/base.js';
import { AGENT_ROLE_LABELS, type AgentRole } from '../../agents/types.js';
import { isPositive, type Verdict, type VerdictRole, isVerdictRole } from '../../agents/verdicts.js';
import { ChangeSet } from '../../tools/repo.js';
import type { McpRegistry } from '../../mcp/registry.js';
import type { AppConfig } from '../config/types.js';
import { WorkflowError } from '../errors.js';
import { logger } from '../../utils/logger.js';
import { buildTestCommand } from '../../utils/package-manager.js';
import { createStreamRenderer } from '../../cli/utils/stream-renderer.js';
import { confirmCommand } from '../../cli/utils/confirm-command.js';
import { failRun, mergeFiles, type StepRecord, type WorkflowContext } from './engine.js';
import { nextStep, stepById, type WorkflowDefinition, type WorkflowStep } from './definition.js';
import { parseAndWriteFiles } from './file-parser.js';
import { runTests } from './test-runner.js';
import { runLint, runFormat } from './lint-runner.js';
import { requestApproval, requestStepReview, isApprovalGated } from './approval.js';
import type { TokenTracker } from './token-tracker.js';
import { formatPolicyForAgent, type QAPolicy } from './qa-policy.js';
import { formatContextForAgent, formatSourcesForAgent, type ContextDocument } from './context-loader.js';
import { buildRepoMap } from './repo-map.js';

export interface ExecutorParams {
    ctx: WorkflowContext;
    workflow: WorkflowDefinition;
    /** Where agents work: the project root or its worktree. */
    projectRoot: string;
    config: AppConfig;
    tokenTracker: TokenTracker;
    qaPolicy: QAPolicy;
    contextDocs: ContextDocument[];
    /** Full sources, only used in legacyFileBlocks mode. */
    sourceDocs: ContextDocument[];
    auto: boolean;
    streaming: boolean;
    mcpRegistry?: McpRegistry;
    /** Called after every step (crash recovery). */
    onStep?: (ctx: WorkflowContext) => void;
}

/** What happened when a step ran. */
interface StepResult {
    ctx: WorkflowContext;
    output?: AgentOutput;
    /** A check or gate failed; the run routes to onFail. */
    failure?: string;
    /** The run must stop. */
    abort?: string;
    /** Run the same step again (plan regeneration). */
    rerun?: boolean;
}

/**
 * Run `params.ctx` until it passes or fails.
 */
export async function executeWorkflow(params: ExecutorParams): Promise<WorkflowContext> {
    const { workflow, config, auto } = params;
    let ctx = params.ctx;

    while (ctx.status === 'running') {
        const step = ctx.step ? stepById(workflow, ctx.step) : undefined;
        if (!step) {
            ctx = failRun(ctx, `Workflow "${workflow.name}" has no step "${ctx.step ?? ''}"`);
            break;
        }

        let result: StepResult;
        try {
            result = await runStep(step, ctx, params);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(message);
            result = { ctx, abort: message };
        }
        ctx = result.ctx;

        if (result.rerun) continue;
        ctx = route(ctx, step, workflow, result);
        params.onStep?.(ctx);

        // Optional human checkpoint between steps
        if (config.workflow.humanApproval && !auto && ctx.status === 'running' && result.output) {
            const decision = await requestApproval(ctx, AGENT_ROLE_LABELS[step.agent], result.output.content);
            if (decision === 'abort') {
                ctx = failRun(ctx, 'User aborted');
            } else if (decision === 'retry') {
                logger.info(`Re-running ${step.id}...`);
                ctx = { ...ctx, step: step.id };
            }
        }
    }

    if (ctx.status === 'passed') logger.success('Workflow complete!');
    return ctx;
}

/** Record the step and decide what runs next. */
function route(ctx: WorkflowContext, step: WorkflowStep, workflow: WorkflowDefinition, result: StepResult): WorkflowContext {
    const record = (outcome: StepRecord['outcome'], detail?: string): StepRecord => ({
        step: step.id, agent: step.agent, outcome, ...(detail ? { detail: firstLine(detail) } : {}), timestamp: Date.now(),
    });

    if (result.abort) {
        return failRun({ ...ctx, history: [...ctx.history, record('aborted', result.abort)] }, result.abort);
    }

    if (result.failure && !step.onFail) {
        // No recovery step: the failure is the result (e.g. review-only workflows)
        return failRun({ ...ctx, history: [...ctx.history, record('failed', result.failure)] }, firstLine(result.failure));
    }

    if (result.failure) {
        const iteration = ctx.iteration + 1;
        const history = [...ctx.history, record('failed', result.failure)];
        if (iteration >= ctx.maxIterations) {
            logger.warn(`Max iterations (${ctx.maxIterations}) reached.`);
            return failRun({ ...ctx, iteration, history }, `Max iterations (${ctx.maxIterations}) exceeded`);
        }
        return { ...ctx, iteration, history, step: step.onFail };
    }

    const history = [...ctx.history, record('passed')];
    const next = nextStep(workflow, step);
    return next ? { ...ctx, history, step: next.id } : { ...ctx, history, status: 'passed', step: undefined };
}

// ── Running one step ──

async function runStep(step: WorkflowStep, ctx: WorkflowContext, p: ExecutorParams): Promise<StepResult> {
    const { config, projectRoot, auto, streaming } = p;
    const label = AGENT_ROLE_LABELS[step.agent];
    const spinner = ora(`Running ${step.id} (${step.agent})...`).start();
    const changes = new ChangeSet();

    const agent = createAgent(step.agent, config, projectRoot, {
        tools: p.mcpRegistry?.toolsFor(step.agent),
        changes,
        maxTurns: step.maxTurns,
        // Pause the spinner while asking, so the prompt stays readable
        confirmCommand: auto ? undefined : async (command) => {
            const spinning = spinner.isSpinning;
            spinner.stop();
            const answer = await confirmCommand(command);
            if (spinning) spinner.start();
            return answer;
        },
    });

    const repoMap = !config.workflow.legacyFileBlocks && config.project.repoMapTokens > 0
        ? await buildRepoMap(projectRoot, { maxTokens: config.project.repoMapTokens })
        : undefined;
    const input: AgentInput = {
        task: ctx.task,
        context: buildAgentContext(ctx, config, step.agent, { qaPolicy: p.qaPolicy, contextDocs: p.contextDocs, sourceDocs: p.sourceDocs, repoMap }),
        previousOutput: previousOutputFor(step.agent, ctx),
    };

    let output: AgentOutput;
    try {
        if (streaming) {
            spinner.stop();
            const renderer = createStreamRenderer(step.agent);
            output = await agent.executeStreaming(input, renderer.callbacks);
            renderer.finish();
        } else {
            output = await agent.execute(input);
            spinner.succeed(`${step.id} complete (${output.tokensUsed} tokens)`);
        }
    } catch (err) {
        spinner.fail(`${step.id} failed`);
        throw err;
    }

    p.tokenTracker.record(step.agent, config.agents[step.agent].model, output.usage);

    // Review gate: let the user approve, edit, or regenerate this step's output
    if (!auto && (step.approval || isApprovalGated(step.agent, config.workflow.approvalGates))) {
        const review = await requestStepReview(label, output.content);
        if (review.action === 'abort') return { ctx, abort: `User aborted after reviewing ${step.id}` };
        if (review.action === 'regenerate') {
            logger.info(`Regenerating ${step.id} with feedback: "${review.feedback}"`);
            return { ctx: { ...ctx, task: `${ctx.task}\n\n[FEEDBACK]: ${review.feedback}` }, rerun: true };
        }
        if (review.action === 'edit') output = { ...output, content: review.output };
    }

    const applied = applyOutput(ctx, step, output, changes, p);
    if (applied.failure) return { ...applied, output };

    const checked = await runChecks(applied.ctx, step, p);
    return { ...checked, output };
}

/** Update the run context from an agent's output; a negative gated verdict is a failure. */
function applyOutput(ctx: WorkflowContext, step: WorkflowStep, output: AgentOutput, changes: ChangeSet, p: ExecutorParams): StepResult {
    const { content } = output;

    switch (step.agent) {
        case 'architect':
            return { ctx: { ...ctx, spec: content, plan: content } };

        case 'coder':
        case 'fixer': {
            const files = collectChangedFiles(changes, content, p.projectRoot, p.config);
            return {
                ctx: {
                    ...ctx,
                    generatedFiles: mergeFiles(ctx.generatedFiles, files),
                    changeSummary: content,
                    // The fixer has addressed the last failure
                    ...(step.agent === 'fixer' ? { lastFailure: undefined } : {}),
                },
            };
        }

        case 'tester': {
            const files = collectChangedFiles(changes, content, p.projectRoot, p.config);
            return { ctx: { ...ctx, testFiles: mergeFiles(ctx.testFiles, files) } };
        }

        case 'reviewer':
        case 'security':
        case 'judge': {
            const verdict = requireVerdict(output, step.agent);
            logIssueCounts(AGENT_ROLE_LABELS[step.agent], verdict);
            let next: WorkflowContext = { ...ctx, verdicts: { ...ctx.verdicts, [step.agent]: verdict } };
            if (step.agent === 'reviewer') next = { ...next, reviewFeedback: content };
            if (step.agent === 'security') next = { ...next, securityFindings: content };

            if (step.gate === 'verdict' && !isPositive(verdict)) {
                const failure = `${AGENT_ROLE_LABELS[step.agent]} did not pass the change:\n\n${content}`;
                if (step.agent === 'security') logger.warn('Security review found issues — routing to the fixer.');
                return { ctx: { ...next, lastFailure: failure }, failure };
            }
            return { ctx: next };
        }
    }
}

/** Run the step's checks in order; stop at the first failure. */
async function runChecks(ctx: WorkflowContext, step: WorkflowStep, p: ExecutorParams): Promise<StepResult> {
    const { config, projectRoot } = p;

    for (const check of step.checks) {
        if (check === 'format' && config.workflow.formatCommand) {
            await runFormat(projectRoot, config.workflow.formatCommand);
        }

        if (check === 'lint' && config.workflow.lintCommand) {
            const lint = await runLint(projectRoot, config.workflow.lintCommand);
            if (lint.passed) continue;
            if (isRepeatedFailure(lint.output, ctx.previousFailures)) {
                logger.warn('Repeated lint failure — the fixer could not resolve these lint errors. Continuing.');
                continue;
            }
            const failure = `Lint errors:\n${lint.output}`;
            return { ctx: { ...ctx, previousFailures: [...ctx.previousFailures, lint.output], testFailures: failure, lastFailure: failure }, failure };
        }

        if (check === 'test' && config.workflow.autoRunTests) {
            const command = config.workflow.testCommand ?? buildTestCommand(config.project.testFramework, projectRoot);
            const tests = await runTests(projectRoot, command);
            if (tests.passed) {
                ctx = { ...ctx, testFailures: undefined };
                continue;
            }
            if (isRepeatedFailure(tests.output, ctx.previousFailures)) {
                logger.warn('Repeated test failure detected — same errors after a fix attempt. Stopping.');
                return { ctx, abort: 'Repeated test failure — the fixer could not resolve the issue' };
            }
            const failure = `Test failures:\n${tests.output}`;
            return { ctx: { ...ctx, previousFailures: [...ctx.previousFailures, tests.output], testFailures: tests.output, lastFailure: failure }, failure };
        }
    }

    return { ctx };
}

// ── Agent input ──

/** What each agent builds on: the plan, the failure to fix, or the latest change summary. */
function previousOutputFor(agent: AgentRole, ctx: WorkflowContext): string | undefined {
    switch (agent) {
        case 'architect':
            return undefined;
        case 'coder':
            return ctx.plan;
        case 'fixer':
            return ctx.lastFailure;
        default:
            return ctx.changeSummary;
    }
}

/** Build the context section of an agent's prompt from the run so far. */
export function buildAgentContext(
    ctx: WorkflowContext,
    config: AppConfig,
    agentRole: AgentRole,
    sources: { qaPolicy?: QAPolicy; contextDocs?: ContextDocument[]; sourceDocs?: ContextDocument[]; repoMap?: string },
): string {
    const { qaPolicy, contextDocs, sourceDocs, repoMap } = sources;
    const parts: string[] = [];

    // Project settings so agents know the language, framework, and test tools
    parts.push([
        '## Project Settings',
        `- Language: ${config.project.language}`,
        `- Framework: ${config.project.framework}`,
        `- Test framework: ${config.project.testFramework}`,
        '',
        'IMPORTANT: All code MUST be written in the language and framework specified above.',
    ].join('\n'));

    // Reference documents so all agents see them
    if (contextDocs && contextDocs.length > 0) {
        parts.push(formatContextForAgent(contextDocs));
    }

    // Agents with read tools get a map and fetch code on demand
    if (repoMap) {
        parts.push(repoMap);
    }

    // Legacy mode: code agents have no read tools, so inline the sources
    const codeAgents: AgentRole[] = ['coder', 'fixer', 'tester'];
    if (sourceDocs && sourceDocs.length > 0 && codeAgents.includes(agentRole)) {
        parts.push(formatSourcesForAgent(sourceDocs));
    }

    if (ctx.spec) parts.push(`## Spec\n${ctx.spec}`);
    if (ctx.plan) parts.push(`## Plan\n${ctx.plan}`);
    if (ctx.reviewFeedback) parts.push(`## Review Feedback\n${ctx.reviewFeedback}`);
    if (ctx.securityFindings) parts.push(`## Security Findings\n${ctx.securityFindings}`);
    if (ctx.testFailures) parts.push(`## Test Failures\n${ctx.testFailures}`);
    if (ctx.generatedFiles.length > 0) {
        parts.push(`## Modified Files\n${ctx.generatedFiles.join('\n')}`);
    }

    if (qaPolicy && agentRole === 'judge') {
        parts.push(formatPolicyForAgent(qaPolicy));
    }

    return parts.join('\n\n');
}

// ── Helpers ──

/** The structured verdict a judging agent attached to its output. */
function requireVerdict(output: AgentOutput, role: VerdictRole): Verdict {
    const verdict = output.metadata?.verdict as Verdict | undefined;
    if (!verdict || !isVerdictRole(role)) {
        throw new WorkflowError(`${AGENT_ROLE_LABELS[role]} produced no verdict`, { role });
    }
    return verdict;
}

function logIssueCounts(label: string, verdict: Verdict): void {
    if (verdict.issues.length === 0) return;
    const counts = new Map<string, number>();
    for (const issue of verdict.issues) counts.set(issue.severity, (counts.get(issue.severity) ?? 0) + 1);
    logger.info(`${label}: ${[...counts].map(([sev, n]) => `${n} ${sev}`).join(', ')}`);
}

/**
 * Files a code-writing agent changed during its step.
 *
 * Normally these are the files it edited through tools. If it made no tool
 * edits but replied with `FILE:` blocks (legacy mode, or a model that ignores
 * tools), those blocks are written instead.
 */
function collectChangedFiles(changes: ChangeSet, content: string, projectRoot: string, config: AppConfig): string[] {
    if (changes.size > 0) return changes.files;

    const written = parseAndWriteFiles(projectRoot, content);
    if (written.length > 0 && !config.workflow.legacyFileBlocks) {
        logger.warn('Agent replied with FILE: blocks instead of editing through tools; wrote them anyway.');
    }
    return written;
}

function firstLine(text: string): string {
    const line = text.split('\n').find(l => l.trim()) ?? '';
    return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

/**
 * Check if a check's failure output matches any previous failure.
 *
 * Uses two strategies:
 * 1. Error signature match — extracts error types/messages and compares
 * 2. Line-level similarity — if >50% of meaningful lines match, it's a repeat
 */
export function isRepeatedFailure(current: string, previous: string[]): boolean {
    if (previous.length === 0) return false;

    const currentErrors = extractErrorSignatures(current);
    const currentLines = normalizeLines(current);

    for (const prev of previous) {
        // Strategy 1: same error signatures
        const prevErrors = extractErrorSignatures(prev);
        if (currentErrors.length > 0 && prevErrors.length > 0) {
            const overlap = currentErrors.filter((e) => prevErrors.includes(e)).length;
            if (overlap / Math.max(currentErrors.length, prevErrors.length) > 0.5) return true;
        }

        // Strategy 2: line-level similarity
        const prevLines = normalizeLines(prev);
        if (currentLines.length > 0 && prevLines.length > 0) {
            const matched = currentLines.filter((line) => prevLines.includes(line)).length;
            const similarity = matched / Math.max(currentLines.length, prevLines.length);
            if (similarity > 0.5) return true;
        }
    }

    return false;
}

/** Extract error type/message signatures from check output. */
function extractErrorSignatures(output: string): string[] {
    const patterns = [
        /(?:Error|FAIL|panic|undefined|cannot).*$/gmi,
        /expected .+ got .+/gi,
        /no such file or directory/gi,
    ];
    const signatures: string[] = [];
    for (const pattern of patterns) {
        for (const match of output.matchAll(pattern)) {
            // Normalize: trim, lowercase, strip paths and line numbers
            const sig = match[0].trim().toLowerCase()
                .replace(/\b\d+\b/g, 'N')
                .replace(/\/[\w./]+/g, '<path>');
            signatures.push(sig);
        }
    }
    return [...new Set(signatures)];
}

/** Normalize check output lines for comparison — trim, drop noise. */
function normalizeLines(output: string): string[] {
    return output
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .filter((l) => !/^\d{4}-\d{2}-\d{2}/.test(l)) // drop timestamp lines
        .filter((l) => !/^(ok|PASS|\?)/.test(l)); // drop pass/skip lines
}
