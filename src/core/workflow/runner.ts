/**
 * Workflow runner — orchestrates agents through the workflow engine.
 *
 * This is the main "brain" that:
 * 1. Creates a workflow context for a task
 * 2. Determines which agent to run next
 * 3. Executes agents and feeds output to the workflow engine
 * 4. Handles transitions, loops, and terminal states
 * 5. Tracks token usage and persists session state
 *
 * Dependency direction: runner.ts → engine, agents/factory, git/client, config
 * Used by: cli/commands/run.ts
 */

import chalk from 'chalk';
import ora from 'ora';
import {
    createWorkflowContext,
    transition,
    isTerminal,
    getNextAgent,
    type WorkflowContext,
} from './engine.js';
import { createAgent } from '../../agents/factory.js';
import { GitClient } from '../../git/client.js';
import { parseAndWriteFiles } from './file-parser.js';
import { runTests } from './test-runner.js';
import { requestApproval, needsApproval } from './approval.js';
import { TokenTracker } from './token-tracker.js';
import { saveSession, loadSession, listSessions } from './session.js';
import { loadQAPolicy, evaluateReview, formatPolicyForAgent, type QAPolicy } from './qa-policy.js';
import { loadContextDocuments, formatContextForAgent, loadSourceFiles, formatSourcesForAgent, type ContextDocument } from './context-loader.js';
import { loadConfig } from '../config/manager.js';
import type { AppConfig } from '../config/types.js';
import { logger } from '../../utils/logger.js';
import { buildTestCommand } from '../../utils/package-manager.js';
import { WORKFLOW_PRESETS, type WorkflowMode } from '../config/defaults.js';
import { WorkflowError } from '../errors.js';
import { createStreamRenderer } from '../../cli/utils/stream-renderer.js';

export interface RunOptions {
    /** Project root directory. */
    projectRoot: string;
    /** The task to accomplish. */
    task: string;
    /** Skip all human approval gates (autonomous mode). */
    auto?: boolean;
    /** Workflow mode override (fast, balanced, strict). Overrides config. */
    mode?: string;
    /** Explicit context file paths to load. */
    contextPaths?: string[];
    /** Stream agent output in real time (default: true, use --no-stream to disable). */
    streaming?: boolean;
}

export interface ResumeOptions {
    /** Project root directory. */
    projectRoot: string;
    /** Session ID to resume. If not provided, resumes the most recent non-terminal session. */
    sessionId?: string;
    /** Skip all human approval gates (autonomous mode). */
    auto?: boolean;
    /** Workflow mode override (fast, balanced, strict). Overrides config. */
    mode?: string;
    /** Stream agent output in real time (default: true). */
    streaming?: boolean;
}

/**
 * Run a full workflow for a task.
 *
 * Orchestrates the agent pipeline: Architect → Coder → Reviewer → Tester → Fixer → Judge.
 * Returns the final workflow context with all accumulated data.
 */
export async function runWorkflow(options: RunOptions): Promise<WorkflowContext> {
    const { projectRoot, task, auto = false, mode, contextPaths, streaming = true } = options;
    const config = loadConfig(projectRoot);

    // Apply mode preset override from --mode flag
    if (mode) {
        applyModePreset(config, mode);
    }

    const tokenTracker = new TokenTracker();
    const qaPolicy = loadQAPolicy(projectRoot);
    const contextDocs = loadContextDocuments(projectRoot, contextPaths);
    const sourceDocs = loadSourceFiles(projectRoot, config.project.sourceGlobs);

    logger.header('AI Workflow — Running Task');
    console.log(chalk.gray(`Task: ${task}`));
    if (mode) {
        console.log(chalk.blue(`Mode: ${mode}`));
    }
    if (auto) {
        console.log(chalk.yellow('⚡ Autonomous mode — no human approval required'));
    }
    console.log();

    // Optional: create a Git branch for this task
    if (config.workflow.autoCreateBranch) {
        const git = new GitClient(projectRoot);
        const isRepo = await git.isRepo();

        if (isRepo) {
            const branchName = GitClient.toBranchName(config.workflow.branchPrefix, task);
            await git.createBranch(branchName);
        }
    }

    // Create workflow context
    const ctx = createWorkflowContext(task, config.workflow.maxIterations);

    return executeWorkflowLoop({
        ctx,
        projectRoot,
        config,
        tokenTracker,
        qaPolicy,
        contextDocs,
        sourceDocs,
        auto,
        streaming,
    });
}

/**
 * Resume an interrupted or failed workflow from a saved session.
 *
 * Loads the session, restores state, and re-enters the workflow loop.
 */
export async function resumeWorkflow(options: ResumeOptions): Promise<WorkflowContext> {
    const { projectRoot, auto = false, mode, streaming = true } = options;
    let { sessionId } = options;

    // If no session ID, find the most recent non-terminal session
    if (!sessionId) {
        const sessions = listSessions(projectRoot);
        const resumable = sessions.find(s => !isTerminal(s.context));
        if (!resumable) {
            throw new WorkflowError('No resumable sessions found. Run "aiagentflow sessions" to see all sessions.');
        }
        sessionId = resumable.id;
    }

    const session = loadSession(projectRoot, sessionId);
    if (!session) {
        throw new WorkflowError(`Session not found: ${sessionId}`, { sessionId });
    }

    if (isTerminal(session.context)) {
        throw new WorkflowError(
            `Session "${sessionId}" is in terminal state "${session.context.state}" and cannot be resumed.`,
            { sessionId, state: session.context.state },
        );
    }

    const config = loadConfig(projectRoot);
    if (mode) {
        applyModePreset(config, mode);
    }

    const tokenTracker = new TokenTracker();
    tokenTracker.restoreEntries(session.tokenUsage);
    const qaPolicy = loadQAPolicy(projectRoot);
    const contextDocs = loadContextDocuments(projectRoot);
    const sourceDocs = loadSourceFiles(projectRoot, config.project.sourceGlobs);

    logger.header('AI Workflow — Resuming Session');
    console.log(chalk.gray(`Session: ${sessionId}`));
    console.log(chalk.gray(`Task: ${session.context.task}`));
    console.log(chalk.gray(`Resuming from state: ${session.context.state}`));
    if (mode) {
        console.log(chalk.blue(`Mode: ${mode}`));
    }
    if (auto) {
        console.log(chalk.yellow('⚡ Autonomous mode — no human approval required'));
    }
    console.log();

    return executeWorkflowLoop({
        ctx: session.context,
        sessionId,
        projectRoot,
        config,
        tokenTracker,
        qaPolicy,
        contextDocs,
        sourceDocs,
        auto,
        streaming,
    });
}

// ── Workflow loop ──

interface WorkflowLoopParams {
    ctx: WorkflowContext;
    sessionId?: string;
    projectRoot: string;
    config: AppConfig;
    tokenTracker: TokenTracker;
    qaPolicy: QAPolicy;
    contextDocs: ContextDocument[];
    sourceDocs: ContextDocument[];
    auto: boolean;
    streaming: boolean;
}

/**
 * Core workflow loop — shared by runWorkflow() and resumeWorkflow().
 *
 * Executes agents in sequence, handles transitions, saves sessions,
 * and applies post-loop logic (auto-commit, summaries).
 */
async function executeWorkflowLoop(params: WorkflowLoopParams): Promise<WorkflowContext> {
    const { projectRoot, config, tokenTracker, qaPolicy, contextDocs, sourceDocs, auto, streaming } = params;
    let ctx = params.ctx;
    let sessionId = params.sessionId;
    let lastOutput = '';

    try {
        while (!isTerminal(ctx)) {
            const agentRole = getNextAgent(ctx);

            if (!agentRole) {
                if (ctx.state === 'qa_approved') {
                    logger.success('Workflow complete!');
                    break;
                }
                logger.warn('No agent mapped to current state — stopping.');
                break;
            }

            const agent = createAgent(agentRole, config, projectRoot);
            const agentConfig = config.agents[agentRole];
            const spinner = ora(`Running ${agentRole} agent...`).start();

            try {
                const agentInput = {
                    task: ctx.task,
                    context: buildAgentContext(ctx, config, agentRole, qaPolicy, contextDocs, sourceDocs),
                    previousOutput: getLatestOutput(ctx),
                };

                let output;
                if (streaming) {
                    spinner.stop();
                    const renderer = createStreamRenderer(agentRole);
                    output = await agent.executeStreaming(agentInput, renderer.callbacks);
                    renderer.finish();
                } else {
                    output = await agent.execute(agentInput);
                    spinner.succeed(`${agentRole} complete (${output.tokensUsed} tokens)`);
                }
                lastOutput = output.content;

                // Track token usage
                tokenTracker.record(agentRole, agentConfig.model, {
                    promptTokens: 0, // TODO: Get from provider response
                    completionTokens: output.tokensUsed,
                    totalTokens: output.tokensUsed,
                });

                // Transition based on agent output
                ctx = await applyAgentOutput(ctx, agentRole, output.content, config, projectRoot, qaPolicy);
            } catch (err) {
                spinner.fail(`${agentRole} failed`);

                if (err instanceof WorkflowError) throw err;
                logger.error(err instanceof Error ? err.message : String(err));

                ctx = transition(ctx, { type: 'ABORT', payload: { reason: String(err) } });
            }

            // Save session after each step (crash recovery)
            sessionId = saveSession(projectRoot, ctx, tokenTracker.getEntries(), sessionId);

            // Human approval gate (skipped in autonomous mode)
            const shouldApprove = !auto && needsApproval(config.workflow.humanApproval, ctx.state);
            if (shouldApprove && !isTerminal(ctx)) {
                const decision = await requestApproval(ctx, agentRole!, lastOutput);

                if (decision === 'abort') {
                    ctx = transition(ctx, { type: 'ABORT', payload: { reason: 'User aborted' } });
                } else if (decision === 'retry') {
                    logger.info('Retrying agent...');
                }
            }
        }
    } catch (err) {
        logger.error(`Workflow failed: ${err instanceof Error ? err.message : String(err)}`);
        if (!isTerminal(ctx)) {
            ctx = transition(ctx, { type: 'ABORT', payload: { reason: String(err) } });
        }
    }

    // Auto-commit if QA passed and autoCommit is enabled
    if (config.workflow.autoCommit && ctx.state === 'qa_approved') {
        try {
            const git = new GitClient(projectRoot);
            if (await git.isRepo()) {
                const message = (config.workflow.autoCommitMessage ?? 'ai: {task}')
                    .replace('{task}', ctx.task);
                const hash = await git.commitAll(message);
                logger.success(`Auto-committed: ${hash}`);
            }
        } catch (err) {
            logger.warn(`Auto-commit failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // Final save
    saveSession(projectRoot, ctx, tokenTracker.getEntries(), sessionId);

    // Print summaries
    printWorkflowSummary(ctx);
    tokenTracker.printSummary();

    return ctx;
}

// ── Private helpers ──

/** Resolve the test command from config, falling back to auto-detected defaults. */
function getTestCommand(config: AppConfig, projectRoot: string): string {
    if (config.workflow.testCommand) {
        return config.workflow.testCommand;
    }
    return buildTestCommand(config.project.testFramework, projectRoot);
}

/** Apply a workflow mode preset to the config, overriding relevant fields. */
function applyModePreset(config: AppConfig, mode: string): void {
    const validModes = Object.keys(WORKFLOW_PRESETS);
    if (!validModes.includes(mode)) {
        throw new WorkflowError(
            `Invalid workflow mode: "${mode}". Valid modes: ${validModes.join(', ')}`,
            { mode, validModes },
        );
    }

    const preset = WORKFLOW_PRESETS[mode as WorkflowMode];
    config.workflow.mode = mode as WorkflowMode;
    config.workflow.maxIterations = preset.maxIterations;
    config.workflow.humanApproval = preset.humanApproval;
    config.workflow.autoCommit = preset.autoCommit;

    for (const [role, temp] of Object.entries(preset.temperatures)) {
        if (config.agents[role as keyof typeof config.agents]) {
            config.agents[role as keyof typeof config.agents].temperature = temp;
        }
    }
}

/** Build context string for the current agent based on workflow state. */
function buildAgentContext(
    ctx: WorkflowContext,
    config: AppConfig,
    agentRole: string,
    qaPolicy?: QAPolicy,
    contextDocs?: ContextDocument[],
    sourceDocs?: ContextDocument[],
): string {
    const parts: string[] = [];

    // Inject project settings so agents know the language, framework, and test tools
    parts.push([
        '## Project Settings',
        `- Language: ${config.project.language}`,
        `- Framework: ${config.project.framework}`,
        `- Test framework: ${config.project.testFramework}`,
        '',
        'IMPORTANT: All code MUST be written in the language and framework specified above.',
    ].join('\n'));

    // Inject reference documents so all agents see them
    if (contextDocs && contextDocs.length > 0) {
        parts.push(formatContextForAgent(contextDocs));
    }

    // Inject existing source files for agents that generate code
    const codeAgents = ['coder', 'fixer', 'tester'];
    if (sourceDocs && sourceDocs.length > 0 && codeAgents.includes(agentRole)) {
        parts.push(formatSourcesForAgent(sourceDocs));
    }

    if (ctx.spec) parts.push(`## Spec\n${ctx.spec}`);
    if (ctx.plan) parts.push(`## Plan\n${ctx.plan}`);
    if (ctx.reviewFeedback) parts.push(`## Review Feedback\n${ctx.reviewFeedback}`);
    if (ctx.testFailures) parts.push(`## Test Failures\n${ctx.testFailures}`);
    if (ctx.generatedFiles.length > 0) {
        parts.push(`## Modified Files\n${ctx.generatedFiles.join('\n')}`);
    }

    // Include QA policy for the judge agent
    if (qaPolicy && ctx.state === 'tests_passed') {
        parts.push(formatPolicyForAgent(qaPolicy));
    }

    return parts.join('\n\n');
}

/** Get the most recent output relevant to the next agent. */
function getLatestOutput(ctx: WorkflowContext): string | undefined {
    if (ctx.spec && ctx.state === 'spec_created') return ctx.spec;
    if (ctx.plan && ctx.state === 'plan_approved') return ctx.plan;
    if (ctx.reviewFeedback) return ctx.reviewFeedback;
    if (ctx.testFailures) return ctx.testFailures;
    return undefined;
}

/**
 * Apply an agent's output to the workflow context via state transition.
 */
async function applyAgentOutput(
    ctx: WorkflowContext,
    role: string,
    content: string,
    config: AppConfig,
    projectRoot: string,
    qaPolicy: QAPolicy,
): Promise<WorkflowContext> {
    switch (role) {
        case 'architect':
            if (ctx.state === 'idle') {
                ctx = transition(ctx, { type: 'SPEC_READY', payload: { spec: content } });
                ctx = transition(ctx, { type: 'PLAN_APPROVED', payload: { plan: content } });
            }
            return ctx;

        case 'coder': {
            const files = parseAndWriteFiles(projectRoot, content);
            return transition(ctx, {
                type: 'CODE_GENERATED',
                payload: { files: files.length > 0 ? files : ['(no files parsed)'] },
            });
        }

        case 'reviewer': {
            const upper = content.toUpperCase();
            const reviewApproved = upper.includes('APPROVE') &&
                !upper.includes('REQUEST_CHANGES') &&
                !upper.includes('REJECT');

            // Evaluate review against QA policy (informational when reviewer approves)
            const evaluation = evaluateReview(content, qaPolicy);
            if (evaluation.totalIssues > 0) {
                logger.info(`QA policy: ${evaluation.criticalCount} critical, ${evaluation.warningCount} warning(s), ${evaluation.totalIssues - evaluation.criticalCount - evaluation.warningCount} nit(s)`);
            }

            // Trust the reviewer's explicit verdict.
            // QA policy only blocks when the reviewer did NOT approve.
            const approved = reviewApproved;
            return transition(ctx, { type: 'REVIEW_DONE', payload: { approved, feedback: content } });
        }

        case 'tester': {
            const testFiles = parseAndWriteFiles(projectRoot, content);
            ctx = transition(ctx, {
                type: 'TESTS_WRITTEN',
                payload: { testFiles: testFiles.length > 0 ? testFiles : ['(no test files parsed)'] },
            });

            // Auto-run tests and transition based on results
            if (config.workflow.autoRunTests) {
                const testResult = await runTests(projectRoot, getTestCommand(config, projectRoot));
                if (testResult.passed) {
                    ctx = transition(ctx, { type: 'TESTS_PASSED' });
                } else {
                    // Detect repeated failures — break infinite fix loops
                    if (isRepeatedFailure(testResult.output, ctx.previousFailures)) {
                        logger.warn('Repeated test failure detected — same errors after fix attempt. Stopping.');
                        ctx = transition(ctx, { type: 'ABORT', payload: { reason: 'Repeated test failure — fixer could not resolve the issue' } });
                    } else {
                        ctx.previousFailures.push(testResult.output);
                        ctx = transition(ctx, { type: 'TESTS_FAILED', payload: { failures: testResult.output } });
                    }
                }
            } else {
                // Skip test execution — assume tests pass
                ctx = transition(ctx, { type: 'TESTS_PASSED' });
            }

            return ctx;
        }

        case 'fixer': {
            const fixedFiles = parseAndWriteFiles(projectRoot, content);
            ctx = transition(ctx, {
                type: 'FIX_APPLIED',
                payload: { files: fixedFiles.length > 0 ? fixedFiles : ['(no files parsed)'] },
            });
            // Auto-transition back to code_generated for re-review
            return transition(ctx, {
                type: 'CODE_GENERATED',
                payload: { files: fixedFiles.length > 0 ? fixedFiles : ['(no files parsed)'] },
            });
        }

        case 'judge': {
            const passed = content.toUpperCase().includes('PASS') &&
                !content.toUpperCase().includes('FAIL');
            if (passed) {
                return transition(ctx, { type: 'QA_APPROVED' });
            } else {
                return transition(ctx, { type: 'QA_REJECTED', payload: { reason: content } });
            }
        }

        default:
            return ctx;
    }
}

/** Print a colored summary of the workflow execution. */
function printWorkflowSummary(ctx: WorkflowContext): void {
    console.log();
    logger.header('Workflow Summary');
    console.log(chalk.gray(`Task: ${ctx.task}`));
    console.log(chalk.gray(`Final state: ${ctx.state}`));
    console.log(chalk.gray(`Iterations: ${ctx.iteration}/${ctx.maxIterations}`));
    console.log(chalk.gray(`Steps: ${ctx.history.length}`));

    if (ctx.generatedFiles.length > 0) {
        console.log();
        console.log(chalk.bold('  Files modified:'));
        for (const file of ctx.generatedFiles) {
            console.log(chalk.gray(`    ${file}`));
        }
    }

    if (ctx.history.length > 0) {
        console.log();
        console.log(chalk.bold('  State transitions:'));
        for (const step of ctx.history) {
            const arrow = step.to === 'failed' ? chalk.red('→') : chalk.green('→');
            console.log(chalk.gray(`    ${step.from} ${arrow} ${chalk.white(step.to)} (${step.event})`));
        }
    }

    console.log();
    if (ctx.state === 'complete' || ctx.state === 'qa_approved') {
        logger.success('Task completed successfully!');
    } else if (ctx.state === 'failed') {
        logger.error('Task failed.');
    } else {
        logger.warn(`Task stopped in state: ${ctx.state}`);
    }
}

/**
 * Check if a test failure output matches any previous failure.
 *
 * Uses two strategies:
 * 1. Error signature match — extracts error types/messages and compares
 * 2. Line-level similarity — if >50% of meaningful lines match, it's a repeat
 */
function isRepeatedFailure(current: string, previous: string[]): boolean {
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

/** Extract error type/message signatures from test output. */
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

/** Normalize test output lines for comparison — trim, drop noise. */
function normalizeLines(output: string): string[] {
    return output
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .filter((l) => !/^\d{4}-\d{2}-\d{2}/.test(l))  // drop timestamp lines
        .filter((l) => !/^(ok|PASS|\?)/.test(l));        // drop pass/skip lines
}
