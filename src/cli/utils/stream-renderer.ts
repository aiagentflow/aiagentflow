/**
 * Streaming UI renderer — shows live agent output in the terminal.
 *
 * Prints the agent name header, streams gray text as a preview
 * (truncated to 80 chars), and prints a newline when complete.
 *
 * Dependency direction: stream-renderer.ts → agents/types, chalk
 * Used by: core/workflow/runner.ts
 */

import chalk from 'chalk';
import type { StreamCallbacks, AgentRole } from '../../agents/types.js';
import { AGENT_ROLE_LABELS } from '../../agents/types.js';

/** Max characters to show on the streaming preview line. */
const PREVIEW_MAX = 80;

/**
 * Create a streaming renderer for a given agent role.
 *
 * @returns An object with `callbacks` (pass to executeStreaming) and
 *          `finish()` (call after the agent completes to clean up output).
 */
export function createStreamRenderer(agentRole: AgentRole): {
    callbacks: StreamCallbacks;
    finish: () => void;
} {
    const label = AGENT_ROLE_LABELS[agentRole];
    let lineLength = 0;
    let headerPrinted = false;

    const callbacks: StreamCallbacks = {
        onChunk(text: string) {
            if (!headerPrinted) {
                process.stdout.write(chalk.bold(`  ${label}: `));
                headerPrinted = true;
            }

            // Only show the preview portion (single line, truncated)
            for (const char of text) {
                if (char === '\n') continue; // Skip newlines for preview
                if (lineLength >= PREVIEW_MAX) continue;
                process.stdout.write(chalk.gray(char));
                lineLength++;
            }
        },
        onComplete() {
            if (lineLength > 0 || headerPrinted) {
                if (lineLength >= PREVIEW_MAX) {
                    process.stdout.write(chalk.gray('…'));
                }
                process.stdout.write('\n');
            }
        },
    };

    function finish(): void {
        // Ensure newline if nothing was printed
        if (headerPrinted && lineLength === 0) {
            process.stdout.write('\n');
        }
    }

    return { callbacks, finish };
}
