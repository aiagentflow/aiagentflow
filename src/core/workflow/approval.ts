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
import { logger } from '../../utils/logger.js';
import type { WorkflowContext } from './engine.js';

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
  const preview =
    output.length > 500 ? output.slice(0, 500) + chalk.gray('\n... (truncated)') : output;
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
