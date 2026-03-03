/**
 * Package manager detection via lockfile presence.
 *
 * Scans the project root for known lockfiles and returns the
 * appropriate package manager name and exec command prefix.
 *
 * Dependency direction: package-manager.ts → node:fs, node:path
 * Used by: cli/commands/init.ts, core/workflow/runner.ts
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type PackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm';

export interface PackageManagerInfo {
    /** The package manager name (e.g., 'pnpm'). */
    name: PackageManager;
    /** The prefix used to run package binaries (e.g., 'pnpm exec'). */
    execPrefix: string;
}

/** Lockfile-to-package-manager mapping, checked in priority order. */
const LOCKFILE_MAP: Array<{ files: string[]; pm: PackageManagerInfo }> = [
    { files: ['bun.lockb', 'bun.lock'], pm: { name: 'bun', execPrefix: 'bun' } },
    { files: ['pnpm-lock.yaml'], pm: { name: 'pnpm', execPrefix: 'pnpm exec' } },
    { files: ['yarn.lock'], pm: { name: 'yarn', execPrefix: 'yarn' } },
    { files: ['package-lock.json'], pm: { name: 'npm', execPrefix: 'npx' } },
];

const DEFAULT_PM: PackageManagerInfo = { name: 'npm', execPrefix: 'npx' };

/**
 * Detect the package manager used in a project by checking for lockfiles.
 */
export function detectPackageManager(projectRoot: string): PackageManagerInfo {
    for (const entry of LOCKFILE_MAP) {
        for (const file of entry.files) {
            if (existsSync(join(projectRoot, file))) {
                return entry.pm;
            }
        }
    }
    return DEFAULT_PM;
}

/** Non-JS frameworks that don't need a package manager prefix. */
const STATIC_COMMANDS: Record<string, string> = {
    'pytest': 'pytest',
    'go test': 'go test ./...',
    'cargo test': 'cargo test',
    'junit': 'mvn test',
    'rspec': 'bundle exec rspec',
    'phpunit': 'vendor/bin/phpunit',
};

/** JS/TS test tool arguments (without exec prefix). */
const JS_TEST_TOOLS: Record<string, string> = {
    'vitest': 'vitest run',
    'jest': 'jest',
};

/**
 * Build a test command by prefixing JS/TS test tools with the correct
 * package manager exec command. Non-JS frameworks return as-is.
 */
export function buildTestCommand(testFramework: string, projectRoot: string): string {
    const framework = testFramework.toLowerCase();

    if (STATIC_COMMANDS[framework]) {
        return STATIC_COMMANDS[framework]!;
    }

    const toolArgs = JS_TEST_TOOLS[framework];
    if (toolArgs) {
        const pm = detectPackageManager(projectRoot);
        return `${pm.execPrefix} ${toolArgs}`;
    }

    return 'npm test';
}
