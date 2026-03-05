/**
 * `aiagentflow resume` — Resume an interrupted workflow session.
 *
 * Loads a saved session and re-enters the workflow loop from the
 * last saved state. Useful after crashes, Ctrl+C, or transient errors.
 *
 * Dependency direction: resume.ts → commander, workflow/runner, config
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import { configExists } from '../../core/config/manager.js';
import { resumeWorkflow } from '../../core/workflow/runner.js';
import { logger } from '../../utils/logger.js';

export const resumeCommand = new Command('resume')
    .description('Resume an interrupted or failed workflow session')
    .argument('[session-id]', 'Session ID to resume (default: most recent resumable session)')
    .option('--auto', 'Autonomous mode — skip all human approval gates')
    .option('--mode <mode>', 'Workflow mode override: fast, balanced, or strict')
    .option('--no-stream', 'Disable real-time streaming of agent output')
    .action(async (sessionId: string | undefined, options: { auto?: boolean; mode?: string; stream: boolean }) => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exit(1);
        }

        try {
            const result = await resumeWorkflow({
                projectRoot,
                sessionId,
                auto: options.auto,
                mode: options.mode,
                streaming: options.stream,
            });

            if (result.state === 'failed') {
                process.exit(1);
            }
        } catch (err) {
            logger.error(`Resume failed: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });
