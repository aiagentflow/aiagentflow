/**
 * Human approval — interactive prompts for stage gates.
 *
 * When `humanApproval` is enabled in config, the workflow pauses
 * between stages and asks the user to approve, edit, or abort.
 *
 * Dependency direction: approval.ts → prompts, chalk, utils
 * Used by: workflow runner
 */

import prompts from 'prompts';
import chalk from 'chalk';
import type { WorkflowContext } from './engine.js';
import { openInEditor } from '../../utils/editor.js';

export type ApprovalDecision = 'approve' | 'edit' | 'retry' | 'abort';

/**
 * Ask the user to approve the current stage output.
 *
 * Shows a summary of what happened and gives options to proceed.
 */
export async function requestApproval(
    ctx: WorkflowContext,
    agentRole: string,
    output: string,
): Promise<ApprovalDecision> {
    console.log();
    console.log(chalk.bold.cyan(`── ${agentRole.toUpperCase()} Output ──`));
    console.log();

    // Show a truncated preview of the output
    const preview = output.length > 500
        ? output.slice(0, 500) + chalk.gray('\n... (truncated)')
        : output;
    console.log(preview);

    console.log();
    console.log(chalk.gray(`State: ${ctx.state} | Iteration: ${ctx.iteration}/${ctx.maxIterations}`));
    console.log();

    const { decision } = await prompts({
        type: 'select',
        name: 'decision',
        message: 'How would you like to proceed?',
        choices: [
            { title: chalk.green('✔ Approve') + ' — continue to next stage', value: 'approve' },
            { title: chalk.yellow('↻ Retry') + ' — re-run this agent', value: 'retry' },
            { title: chalk.red('✘ Abort') + ' — stop the workflow', value: 'abort' },
        ],
        initial: 0,
    });

    if (!decision) return 'abort';

    return decision as ApprovalDecision;
}

/**
 * Check if approval is needed based on config and current state.
 */
export function needsApproval(humanApproval: boolean, state: string): boolean {
    if (!humanApproval) return false;

    // Skip approval for terminal states
    const skipStates = ['complete', 'failed', 'idle'];
    return !skipStates.includes(state);
}

/**
 * Result of a plan approval gate.
 */
export type PlanApprovalResult =
    | { action: 'approve'; plan: string }
    | { action: 'edit'; plan: string }
    | { action: 'regenerate'; feedback: string }
    | { action: 'abort' };

/**
 * Show the Architect's plan to the user and let them approve, edit, regenerate, or abort.
 * Returns what should happen next and the (possibly modified) plan text.
 *
 * Loops up to maxRegenerations times if the user keeps choosing "regenerate".
 */
export async function requestPlanApproval(
    plan: string,
    _ctx: WorkflowContext,
): Promise<PlanApprovalResult> {
    console.log();
    console.log(chalk.bold.cyan('── Architect Plan ──'));
    console.log();

    const preview = plan.length > 1200
        ? plan.slice(0, 1200) + chalk.gray('\n... (truncated — choose Edit to see full plan)')
        : plan;
    console.log(preview);
    console.log();

    const { action } = await prompts({
        type: 'select',
        name: 'action',
        message: 'Review the plan before the Coder starts:',
        choices: [
            { title: chalk.green('✔ Approve') + ' — proceed with this plan', value: 'approve' },
            { title: chalk.yellow('✎ Edit') + ' — open in $EDITOR to modify', value: 'edit' },
            { title: chalk.blue('↻ Regenerate') + ' — ask Architect to try again', value: 'regenerate' },
            { title: chalk.red('✘ Abort') + ' — stop the workflow', value: 'abort' },
        ],
        initial: 0,
    });

    if (!action || action === 'abort') return { action: 'abort' };

    if (action === 'approve') return { action: 'approve', plan };

    if (action === 'edit') {
        const edited = await openInEditor(plan);
        return { action: 'edit', plan: edited };
    }

    // Regenerate — collect feedback
    const { feedback } = await prompts({
        type: 'text',
        name: 'feedback',
        message: 'What should the Architect change? (one-line nudge):',
    });

    return { action: 'regenerate', feedback: (feedback as string | undefined) ?? '' };
}

/**
 * Check if an agent role is in the approvalGates list.
 */
export function isApprovalGated(
    agentRole: string,
    approvalGates: readonly string[],
): boolean {
    return approvalGates.includes(agentRole);
}
