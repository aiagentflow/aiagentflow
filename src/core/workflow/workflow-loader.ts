/**
 * Workflow loader: finds built-in and project workflow definitions.
 *
 * Project workflows live in `.aiagentflow/workflows/<name>.yml` (or .yaml).
 * A project file named like a built-in overrides it.
 *
 * Dependency direction: workflow-loader.ts → definition, builtin-workflows, config/defaults
 * Used by: workflow executor, CLI workflow and run commands
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { CONFIG_DIR_NAME } from '../config/defaults.js';
import { WorkflowError } from '../errors.js';
import { BUILTIN_WORKFLOWS } from './builtin-workflows.js';
import { parseWorkflow, type WorkflowDefinition } from './definition.js';

/** The workflow used when none is requested. */
export const DEFAULT_WORKFLOW = 'standard';

export interface LoadedWorkflow {
    definition: WorkflowDefinition;
    /** "built-in", or the path of the project file. */
    source: string;
    /** The YAML it was parsed from. */
    yaml: string;
}

export function getWorkflowsDir(projectRoot: string): string {
    return join(projectRoot, CONFIG_DIR_NAME, 'workflows');
}

/**
 * Load every workflow. Invalid project files are reported in `errors`
 * instead of throwing, so one broken file does not hide the others.
 */
export function loadWorkflows(projectRoot: string): { workflows: Map<string, LoadedWorkflow>; errors: WorkflowError[] } {
    const workflows = new Map<string, LoadedWorkflow>();
    const errors: WorkflowError[] = [];

    for (const [name, yaml] of Object.entries(BUILTIN_WORKFLOWS)) {
        workflows.set(name, { definition: parseWorkflow(yaml, `built-in workflow "${name}"`), source: 'built-in', yaml });
    }

    for (const file of listWorkflowFiles(projectRoot)) {
        try {
            const loaded = loadWorkflowFile(file);
            workflows.set(loaded.definition.name, loaded);
        } catch (err) {
            errors.push(err instanceof WorkflowError ? err : new WorkflowError(String(err), { file }));
        }
    }

    return { workflows, errors };
}

/**
 * Get one workflow by name.
 * @throws {WorkflowError} if it does not exist or its file is invalid
 */
export function getWorkflow(projectRoot: string, name: string = DEFAULT_WORKFLOW): LoadedWorkflow {
    const file = listWorkflowFiles(projectRoot).find(f => stem(f) === name);
    if (file) return loadWorkflowFile(file);

    const builtIn = BUILTIN_WORKFLOWS[name];
    if (builtIn) return { definition: parseWorkflow(builtIn, `built-in workflow "${name}"`), source: 'built-in', yaml: builtIn };

    const available = [...loadWorkflows(projectRoot).workflows.keys()].sort().join(', ');
    throw new WorkflowError(`Unknown workflow "${name}". Available: ${available}`, { name });
}

/**
 * Parse one workflow file. The file name must match the workflow's `name`.
 * @throws {WorkflowError} if the file is invalid
 */
export function loadWorkflowFile(path: string): LoadedWorkflow {
    const yaml = readFileSync(path, 'utf-8');
    const definition = parseWorkflow(yaml, path);
    if (definition.name !== stem(path)) {
        throw new WorkflowError(`${path}: name "${definition.name}" must match the file name "${stem(path)}"`, { path });
    }
    return { definition, source: path, yaml };
}

function listWorkflowFiles(projectRoot: string): string[] {
    const dir = getWorkflowsDir(projectRoot);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter(f => ['.yml', '.yaml'].includes(extname(f)))
        .sort()
        .map(f => join(dir, f));
}

function stem(path: string): string {
    return basename(path, extname(path));
}
