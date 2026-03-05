import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runWorkflow } from '../../../src/core/workflow/runner.js';
import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';

describe('--dry-run flag', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'aiagentflow-dryrun-test-'));
        const configDir = join(tmpDir, '.aiagentflow');
        mkdirSync(configDir, { recursive: true });
        writeFileSync(join(configDir, 'config.json'), JSON.stringify(DEFAULT_CONFIG));
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns idle context without executing agents', async () => {
        const result = await runWorkflow({
            projectRoot: tmpDir,
            task: 'Add a login page',
            dryRun: true,
        });

        expect(result.state).toBe('idle');
        expect(result.task).toBe('Add a login page');
        expect(result.history).toHaveLength(0);
        expect(result.generatedFiles).toHaveLength(0);
    });

    it('does not create git branches', async () => {
        const result = await runWorkflow({
            projectRoot: tmpDir,
            task: 'Test task',
            dryRun: true,
        });

        // If it tried to create a branch in a non-git dir, it would throw
        expect(result.state).toBe('idle');
    });

    it('respects mode override in dry run', async () => {
        const result = await runWorkflow({
            projectRoot: tmpDir,
            task: 'Test task',
            mode: 'strict',
            dryRun: true,
        });

        // Should complete without error — mode is applied to config display
        expect(result.state).toBe('idle');
        expect(result.maxIterations).toBe(10); // strict mode sets this
    });
});
