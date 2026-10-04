/**
 * Interactive approval for agent shell commands.
 *
 * Dependency direction: confirm-command.ts → prompts, chalk, tools/command (types)
 * Used by: core/workflow/runner.ts
 */

import chalk from 'chalk';
import prompts from 'prompts';
import type { ConfirmAnswer } from '../../tools/command.js';

/** Ask the user whether an agent may run `command`. Cancelling counts as "no". */
export async function confirmCommand(command: string): Promise<ConfirmAnswer> {
    const { answer } = await prompts({
        type: 'select',
        name: 'answer',
        message: `Agent wants to run: ${chalk.cyan(command)}`,
        choices: [
            { title: 'Allow once', value: 'yes' },
            { title: 'Allow for the rest of this run', value: 'always' },
            { title: 'Deny', value: 'no' },
        ],
    });
    return (answer as ConfirmAnswer | undefined) ?? 'no';
}
