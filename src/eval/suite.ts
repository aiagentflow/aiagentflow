/**
 * Eval suites: coding tasks with hidden tests that decide pass or fail.
 *
 * A suite is a directory of task directories, each with:
 *   task.yml   id, language, testFramework, prompt, test (visible), check (hidden)
 *   repo/      the starting project the agents work on
 *   hidden/    tests the agents never see; copied in after the run, then `check` runs
 *   solution/  optional reference solution, used to validate the fixture itself
 *
 * Dependency direction: suite.ts → zod, yaml, node:fs
 * Used by: eval/runner.ts, cli/commands/eval.ts
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';

export const evalTaskSchema = z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    language: z.string().min(1),
    testFramework: z.string().min(1),
    /** What the agents are asked to do. */
    prompt: z.string().min(1),
    /** Visible test command; the workflow's test checks run it. */
    test: z.string().min(1),
    /** Hidden test command run after the workflow; exit code 0 means the task passed. */
    check: z.string().min(1),
    /** Workflow to run (default: the eval's --workflow, else "standard"). */
    workflow: z.string().optional(),
});

export type EvalTask = z.infer<typeof evalTaskSchema> & { dir: string };

/** The suite shipped with the CLI (evals/tasks in the package). */
export function defaultSuiteDir(): string {
    // dist/eval/suite.js (or src/eval/suite.ts) → package root
    return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'evals', 'tasks');
}

/**
 * Load every task in a suite directory, sorted by id.
 * @throws {Error} naming the task file when one is invalid
 */
export function loadEvalSuite(suiteDir: string): EvalTask[] {
    if (!existsSync(suiteDir)) throw new Error(`Eval suite not found: ${suiteDir}`);

    const tasks: EvalTask[] = [];
    for (const entry of readdirSync(suiteDir).sort()) {
        const dir = join(suiteDir, entry);
        const file = join(dir, 'task.yml');
        if (!statSync(dir).isDirectory() || !existsSync(file)) continue;

        const parsed = evalTaskSchema.safeParse(parseYaml(readFileSync(file, 'utf-8')));
        if (!parsed.success) {
            const problems = parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
            throw new Error(`${file}: ${problems}`);
        }
        for (const required of ['repo', 'hidden']) {
            if (!existsSync(join(dir, required))) throw new Error(`${dir}: missing ${required}/`);
        }
        tasks.push({ ...parsed.data, dir });
    }
    return tasks;
}
