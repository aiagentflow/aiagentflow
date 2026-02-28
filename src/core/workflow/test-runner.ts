/**
 * Test runner — executes project tests and captures results.
 *
 * Runs the configured test command (e.g., `pnpm test`) and returns
 * whether tests passed and the output.
 *
 * Dependency direction: test-runner.ts → execa, core/errors, utils
 * Used by: workflow runner
 */

import { execa } from 'execa';
import { logger } from '../../utils/logger.js';

export interface TestResult {
    /** Whether all tests passed. */
    passed: boolean;
    /** Stdout + stderr from the test command. */
    output: string;
    /** Exit code of the test command. */
    exitCode: number;
}

/**
 * Run the project's test suite.
 *
 * @param projectRoot - Root directory of the project
 * @param testCommand - The test command to run (default: 'pnpm test')
 */
export async function runTests(
    projectRoot: string,
    testCommand: string = 'pnpm test',
): Promise<TestResult> {
    const parts = testCommand.split(' ');
    const cmd = parts[0] ?? 'pnpm';
    const args = parts.slice(1);

    logger.info(`Running tests: ${testCommand}`);

    try {
        const result = await execa(cmd, args, {
            cwd: projectRoot,
            reject: false, // Don't throw on non-zero exit
            timeout: 120_000, // 2 minute timeout
            env: { ...process.env, FORCE_COLOR: '0' }, // Disable color for cleaner output
        });

        const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
        const passed = result.exitCode === 0;

        if (passed) {
            logger.success('Tests passed');
        } else {
            logger.warn(`Tests failed (exit code: ${result.exitCode})`);
        }

        return { passed, output, exitCode: result.exitCode ?? 1 };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to run tests: ${message}`);

        return {
            passed: false,
            output: message,
            exitCode: 1,
        };
    }
}
