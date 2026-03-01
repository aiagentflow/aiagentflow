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
import { saveSession } from './session.js';
import { loadQAPolicy, evaluateReview, formatPolicyForAgent, type QAPolicy } from './qa-policy.js';
import { loadContextDocuments, formatContextForAgent, type ContextDocument } from './context-loader.js';
import { loadConfig } from '../config/manager.js';
import type { AppConfig } from '../config/types.js';
import { logger } from '../../utils/logger.js';
import { WorkflowError } from '../errors.js';
import { createStreamRenderer } from '../../cli/utils/stream-renderer.js';

export interface RunOptions {
    /** Project root directory. */
    projectRoot: string;
    /** The task to accomplish. */
    task: string;
    /** Skip all human approval gates (autonomous mode). */
    auto?: boolean;
    /** Explicit context file paths to load. */
    contextPaths?: string[];
    /** Enable streaming output from agents. */
    streaming?: boolean;
}

/**
 * Run a full workflow for a task.
 *
 * Orchestrates the agent pipeline: Architect → Coder → Reviewer → Tester → Fixer → Judge.
 * Returns the final workflow context with all accumulated data.
 */
export async function runWorkflow(options: RunOptions): Promise<WorkflowContext> {
    const { projectRoot, task, auto = false, contextPaths, streaming = false } = options;
    const config = loadConfig(projectRoot);
    const tokenTracker = new TokenTracker();
    const qaPolicy = loadQAPolicy(projectRoot);
    const contextDocs = loadContextDocuments(projectRoot, contextPaths);

    logger.header('AI Workflow — Running Task');
    console.log(chalk.gray(`Task: ${task}`));
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
    let ctx = createWorkflowContext(task, config.workflow.maxIterations);
    let sessionId: string | undefined;
    let lastOutput = '';

    try {
        // Main workflow loop
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
                    context: buildAgentContext(ctx, config, qaPolicy, contextDocs),
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
            sessionId = saveSession(projectRoot, ctx, tokenTracker.getEntries() as any[], sessionId);

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

    // Final save
    saveSession(projectRoot, ctx, tokenTracker.getEntries() as any[], sessionId);

    // Print summaries
    printWorkflowSummary(ctx);
    tokenTracker.printSummary();

    return ctx;
}

// ── Private helpers ──

/** Build context string for the current agent based on workflow state. */
function buildAgentContext(ctx: WorkflowContext, config: AppConfig, qaPolicy?: QAPolicy, contextDocs?: ContextDocument[]): string {
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
                const testResult = await runTests(projectRoot);
                if (testResult.passed) {
                    ctx = transition(ctx, { type: 'TESTS_PASSED' });
                } else {
                    ctx = transition(ctx, { type: 'TESTS_FAILED', payload: { failures: testResult.output } });
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
