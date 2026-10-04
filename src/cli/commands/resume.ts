/**
 * `aiagentflow resume` — Resume an interrupted workflow session.
 *
 * Loads a saved session and re-enters the workflow loop from the
 * last saved state. Useful after crashes, Ctrl+C, or transient errors.
 *
 * Dependency direction: resume.ts → commander, workflow/runner, config
 * Used by: cli/index.ts
 */

import { Command, Option } from 'commander';
import { configExists } from '../../core/config/manager.js';
import { resumeWorkflow } from '../../core/workflow/runner.js';
import { enableJsonOutput, OUTPUT_FORMATS, type OutputFormat } from '../utils/json-output.js';
import { ExitCode, exitCodeForError, exitCodeForRun } from '../utils/exit-codes.js';
import { logger } from '../../utils/logger.js';

export const resumeCommand = new Command('resume')
    .description('Resume an interrupted workflow session')
    .argument('[session-id]', 'Session ID to resume (default: most recent resumable session)')
    .addOption(new Option('--output <format>', 'text (default) or json: NDJSON run events on stdout').choices([...OUTPUT_FORMATS]).default('text'))
    .option('--auto', 'Autonomous mode — skip all human approval gates')
    .option('--headless', 'Never prompt (implies --auto); a missing worktree is recreated. For CI')
    .option('--mode <mode>', 'Deprecated: fast, balanced, or strict preset')
    .option('--no-stream', 'Disable real-time streaming of agent output')
    .action(async (sessionId: string | undefined, options: { output: OutputFormat; auto?: boolean; headless?: boolean; mode?: string; stream: boolean }) => {
        const events = options.output === 'json' ? enableJsonOutput() : undefined;
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exitCode = ExitCode.Config;
            return;
        }

        try {
            const result = await resumeWorkflow({
                projectRoot,
                sessionId,
                auto: options.auto,
                headless: options.headless,
                mode: options.mode,
                streaming: options.stream,
                events,
            });
            process.exitCode = exitCodeForRun(result);
        } catch (err) {
            logger.error(`Resume failed: ${err instanceof Error ? err.message : String(err)}`);
            process.exitCode = exitCodeForError(err);
        }
    });
