/**
 * Human approval — interactive prompts for stage gates.
 *
 * When `humanApproval` is enabled in config, the workflow pauses
 * between steps and asks the user to approve, retry, or abort. Steps with
 * `approval: true` (or roles in approvalGates) get a full review: approve,
 * edit, regenerate, or abort.
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
    console.log(chalk.gray(`Next step: ${ctx.step ?? '(done)'} | Iteration: ${ctx.iteration}/${ctx.maxIterations}`));
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
 * Result of reviewing a step's output.
 */
export type StepReviewResult =
    | { action: 'approve'; output: string }
    | { action: 'edit'; output: string }
    | { action: 'regenerate'; feedback: string }
    | { action: 'abort' };

/**
 * Show a step's output (usually the Architect's plan) and let the user
 * approve, edit, regenerate, or abort before the workflow continues.
 */
export async function requestStepReview(label: string, output: string): Promise<StepReviewResult> {
    console.log();
    console.log(chalk.bold.cyan(`── ${label} Output ──`));
    console.log();

    const preview = output.length > 1200
        ? output.slice(0, 1200) + chalk.gray('\n... (truncated — choose Edit to see all of it)')
        : output;
    console.log(preview);
    console.log();

    const { action } = await prompts({
        type: 'select',
        name: 'action',
        message: 'Review this before the workflow continues:',
        choices: [
            { title: chalk.green('✔ Approve') + ' — continue with this output', value: 'approve' },
            { title: chalk.yellow('✎ Edit') + ' — open in $EDITOR to modify', value: 'edit' },
            { title: chalk.blue('↻ Regenerate') + ' — run this step again with feedback', value: 'regenerate' },
            { title: chalk.red('✘ Abort') + ' — stop the workflow', value: 'abort' },
        ],
        initial: 0,
    });

    if (!action || action === 'abort') return { action: 'abort' };

    if (action === 'approve') return { action: 'approve', output };

    if (action === 'edit') {
        const edited = await openInEditor(output);
        return { action: 'edit', output: edited };
    }

    const { feedback } = await prompts({
        type: 'text',
        name: 'feedback',
        message: 'What should change? (one-line nudge):',
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
