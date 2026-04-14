/**
 * Lint and format runners for post-write code quality enforcement.
 *
 * - runFormat: runs the configured format command silently after file writes.
 *   Failures are logged as warnings but never block the workflow.
 * - runLint: runs the configured lint command after code generation.
 *   Returns pass/fail + output so the runner can feed failures to the Fixer.
 *
 * Dependency direction: lint-runner.ts → execa, utils/logger
 * Used by: workflow/runner.ts
 */

import { execa } from 'execa';
import { logger } from '../../utils/logger.js';

export interface LintResult {
    /** Whether lint passed (exit code 0). */
    passed: boolean;
    /** Combined stdout + stderr from the lint command. */
    output: string;
    /** Exit code of the lint process. */
    exitCode: number;
}

/**
 * Run the project's lint command.
 *
 * Returns a result object — never throws. Lint failures are surfaced
 * to the caller so they can be fed back to the Fixer agent.
 */
export async function runLint(
    projectRoot: string,
    lintCommand: string,
): Promise<LintResult> {
    const parts = lintCommand.split(' ');
    const cmd = parts[0] ?? 'npx';
    const args = parts.slice(1);

    logger.info(`Running lint: ${lintCommand}`);

    try {
        const result = await execa(cmd, args, {
            cwd: projectRoot,
            reject: false,
            timeout: 60_000,
            env: { ...process.env, FORCE_COLOR: '0' },
        });

        const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
        const exitCode = result.exitCode ?? (result.failed ? 1 : 0);
        const passed = exitCode === 0;

        if (passed) {
            logger.success('Lint passed');
        } else {
            logger.warn(`Lint failed (exit code: ${exitCode})`);
        }

        return { passed, output, exitCode };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to run lint: ${message}`);
        return { passed: false, output: message, exitCode: 1 };
    }
}

/**
 * Run the project's format command silently after file writes.
 *
 * Runs in "silent" mode — success is not logged, failures are warnings only.
 * Format should never block the workflow; it just cleans up style.
 */
export async function runFormat(
    projectRoot: string,
    formatCommand: string,
): Promise<void> {
    const parts = formatCommand.split(' ');
    const cmd = parts[0] ?? 'npx';
    const args = parts.slice(1);

    logger.debug(`Running format: ${formatCommand}`);

    try {
        const result = await execa(cmd, args, {
            cwd: projectRoot,
            reject: false,
            timeout: 30_000,
            env: { ...process.env, FORCE_COLOR: '0' },
        });

        if (result.exitCode !== 0) {
            const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
            logger.warn(`Format command exited with ${result.exitCode}: ${output.slice(0, 200)}`);
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`Format command failed (non-fatal): ${message}`);
    }
}
