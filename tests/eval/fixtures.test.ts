/**
 * Every shipped eval task must be a fair test: its hidden tests fail on the
 * starting repo and pass on the reference solution.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execaSync } from 'execa';
import { defaultSuiteDir, loadEvalSuite } from '../../src/eval/suite.js';
import { runTests } from '../../src/core/workflow/test-runner.js';
import { setLogLevel, getLogLevel, LogLevel } from '../../src/utils/logger.js';

const hasPython = (() => {
    try {
        execaSync('python3', ['--version']);
        return true;
    } catch {
        return false;
    }
})();

const tasks = loadEvalSuite(defaultSuiteDir());

describe('shipped eval suite', () => {
    const originalLevel = getLogLevel();
    beforeAll(() => setLogLevel(LogLevel.Silent));
    afterAll(() => setLogLevel(originalLevel));

    it('has at least 10 tasks across at least 2 languages', () => {
        expect(tasks.length).toBeGreaterThanOrEqual(10);
        expect(new Set(tasks.map(t => t.language)).size).toBeGreaterThanOrEqual(2);
    });

    it.each(tasks.map(t => [t.id, t] as const))('%s: hidden tests fail on the repo and pass on the solution', async (_id, task) => {
        if (task.language === 'python' && !hasPython) return;
        expect(existsSync(join(task.dir, 'solution'))).toBe(true);

        const workspace = mkdtempSync(join(tmpdir(), 'aiagentflow-fixture-'));
        try {
            cpSync(join(task.dir, 'repo'), workspace, { recursive: true });
            cpSync(join(task.dir, 'hidden'), join(workspace, 'hidden'), { recursive: true });
            expect((await runTests(workspace, task.check)).passed).toBe(false);

            cpSync(join(task.dir, 'solution'), workspace, { recursive: true });
            const after = await runTests(workspace, task.check);
            expect(after.passed, after.output).toBe(true);
        } finally {
            rmSync(workspace, { recursive: true, force: true });
        }
    }, 30_000);
});
