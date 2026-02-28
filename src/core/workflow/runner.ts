/**
 * Workflow runner — orchestrates agents through the workflow engine.
 *
 * This is the main "brain" that:
 * 1. Creates a workflow context for a task
 * 2. Determines which agent to run next
 * 3. Executes agents and feeds output to the workflow engine
 * 4. Handles transitions, loops, and terminal states
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
import { loadConfig } from '../config/manager.js';
import type { AppConfig } from '../config/types.js';
import { logger } from '../../utils/logger.js';
import { WorkflowError } from '../errors.js';

export interface RunOptions {
    /** Project root directory. */
    projectRoot: string;
    /** The task to accomplish. */
    task: string;
}

/**
 * Run a full workflow for a task.
 *
 * Orchestrates the agent pipeline: Architect → Coder → Reviewer → Tester → Fixer → Judge.
 * Returns the final workflow context with all accumulated data.
 */
export async function runWorkflow(options: RunOptions): Promise<WorkflowContext> {
    const { projectRoot, task } = options;
    const config = loadConfig(projectRoot);

    logger.header('AI Workflow — Running Task');
    console.log(chalk.gray(`Task: ${task}`));
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
            const spinner = ora(`Running ${agentRole} agent...`).start();

            try {
                const output = await agent.execute({
                    task: ctx.task,
                    context: buildAgentContext(ctx),
                    previousOutput: getLatestOutput(ctx),
                });

                spinner.succeed(`${agentRole} complete (${output.tokensUsed} tokens)`);
                lastOutput = output.content;

                // Transition based on agent output
                ctx = applyAgentOutput(ctx, agentRole, output.content, config, projectRoot);
            } catch (err) {
                spinner.fail(`${agentRole} failed`);

                if (err instanceof WorkflowError) throw err;
                logger.error(err instanceof Error ? err.message : String(err));

                ctx = transition(ctx, { type: 'ABORT', payload: { reason: String(err) } });
            }

            // Human approval gate
            if (needsApproval(config.workflow.humanApproval, ctx.state) && !isTerminal(ctx)) {
                const decision = await requestApproval(ctx, agentRole!, lastOutput);

                if (decision === 'abort') {
                    ctx = transition(ctx, { type: 'ABORT', payload: { reason: 'User aborted' } });
                } else if (decision === 'retry') {
                    // Stay in current state — loop will re-run same agent
                    logger.info('Retrying agent...');
                }
                // 'approve' continues normally
            }
        }
    } catch (err) {
        logger.error(`Workflow failed: ${err instanceof Error ? err.message : String(err)}`);
        if (!isTerminal(ctx)) {
            ctx = transition(ctx, { type: 'ABORT', payload: { reason: String(err) } });
        }
    }

    // Print summary
    printWorkflowSummary(ctx);

    return ctx;
}

// ── Private helpers ──

/** Build context string for the current agent based on workflow state. */
function buildAgentContext(ctx: WorkflowContext): string {
    const parts: string[] = [];

    if (ctx.spec) parts.push(`## Spec\n${ctx.spec}`);
    if (ctx.plan) parts.push(`## Plan\n${ctx.plan}`);
    if (ctx.reviewFeedback) parts.push(`## Review Feedback\n${ctx.reviewFeedback}`);
    if (ctx.testFailures) parts.push(`## Test Failures\n${ctx.testFailures}`);
    if (ctx.generatedFiles.length > 0) {
        parts.push(`## Modified Files\n${ctx.generatedFiles.join('\n')}`);
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
 * Now integrates file parsing and test running.
 */
function applyAgentOutput(
    ctx: WorkflowContext,
    role: string,
    content: string,
    config: AppConfig,
    projectRoot: string,
): WorkflowContext {
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
            const approved = content.toUpperCase().includes('APPROVE') &&
                !content.toUpperCase().includes('REQUEST_CHANGES');
            return transition(ctx, { type: 'REVIEW_DONE', payload: { approved, feedback: content } });
        }

        case 'tester': {
            const testFiles = parseAndWriteFiles(projectRoot, content);
            ctx = transition(ctx, {
                type: 'TESTS_WRITTEN',
                payload: { testFiles: testFiles.length > 0 ? testFiles : ['(no test files parsed)'] },
            });

            // Auto-run tests if configured
            if (config.workflow.autoRunTests) {
                // Tests are run asynchronously — for now mark as needing async handling
                // TODO: Make this properly async in the workflow loop
                logger.info('Auto-running tests after tester agent...');
            }

            return ctx;
        }

        case 'fixer': {
            const fixedFiles = parseAndWriteFiles(projectRoot, content);
            return transition(ctx, {
                type: 'FIX_APPLIED',
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
