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
import { ReviewerAgent } from '../../agents/roles/reviewer.js';
import { JudgeAgent } from '../../agents/roles/judge.js';
import { GitClient } from '../../git/client.js';
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
    let originalBranch: string | undefined;
    if (config.workflow.autoCreateBranch) {
        const git = new GitClient(projectRoot);
        const isRepo = await git.isRepo();

        if (isRepo) {
            originalBranch = await git.getCurrentBranch();
            const branchName = GitClient.toBranchName(config.workflow.branchPrefix, task);
            await git.createBranch(branchName);
        }
    }

    // Create workflow context
    let ctx = createWorkflowContext(task, config.workflow.maxIterations);

    try {
        // Main workflow loop
        while (!isTerminal(ctx)) {
            const agentRole = getNextAgent(ctx);

            if (!agentRole) {
                // No more agents to run — check if we should complete
                if (ctx.state === 'qa_approved') {
                    // TODO: Generate PR description and finalize
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

                // Transition based on agent output
                ctx = applyAgentOutput(ctx, agentRole, output.content, config);
            } catch (err) {
                spinner.fail(`${agentRole} failed`);

                if (err instanceof WorkflowError) throw err;
                logger.error(err instanceof Error ? err.message : String(err));

                ctx = transition(ctx, { type: 'ABORT', payload: { reason: String(err) } });
            }

            // Human approval gate
            if (config.workflow.humanApproval && !isTerminal(ctx)) {
                // TODO: Implement interactive approval prompt
                // For now, auto-approve all stages
                logger.debug('Auto-approving stage (human approval TODO)');
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
 */
function applyAgentOutput(
    ctx: WorkflowContext,
    role: string,
    content: string,
    _config: AppConfig,
): WorkflowContext {
    switch (role) {
        case 'architect':
            if (ctx.state === 'idle') {
                ctx = transition(ctx, { type: 'SPEC_READY', payload: { spec: content } });
                // Auto-approve plan for now
                // TODO: Parse spec vs plan from architect output
                ctx = transition(ctx, { type: 'PLAN_APPROVED', payload: { plan: content } });
            }
            return ctx;

        case 'coder':
            // TODO: Parse file contents from coder output and write to disk
            return transition(ctx, { type: 'CODE_GENERATED', payload: { files: ['(parsed from output)'] } });

        case 'reviewer': {
            // Check if reviewer approved or requested changes
            const approved = content.toUpperCase().includes('APPROVE') &&
                !content.toUpperCase().includes('REQUEST_CHANGES');
            return transition(ctx, { type: 'REVIEW_DONE', payload: { approved, feedback: content } });
        }

        case 'tester':
            // TODO: Parse test files from output and run them
            return transition(ctx, { type: 'TESTS_WRITTEN', payload: { testFiles: ['(parsed from output)'] } });

        case 'fixer':
            // TODO: Parse fixed files and write to disk
            return transition(ctx, { type: 'FIX_APPLIED', payload: { files: ['(parsed from output)'] } });

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
