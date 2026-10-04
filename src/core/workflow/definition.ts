/**
 * Workflow definitions: pipelines described as data instead of code.
 *
 * A workflow is an ordered list of steps. Each step runs one agent, then
 * optionally runs checks (format, lint, test) and a verdict gate. When a
 * check or gate fails, the workflow jumps to the step's `onFail` target, or
 * fails the run if the step has none; otherwise it continues to `next`
 * (default: the following step).
 * Steps marked `trigger: on-fail` are skipped in normal order and only run
 * when another step routes to them (e.g. the fixer). A step runs either an
 * agent or a plugin step (`uses: <plugin>/<step>`).
 *
 * Definitions live in `.aiagentflow/workflows/*.yml`; built-ins ship with the
 * CLI and can be overridden by a project file with the same name.
 *
 * Dependency direction: definition.ts → zod, yaml, agents/types, core/errors
 * Used by: workflow loader, workflow executor, CLI workflow command
 */

import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { ALL_AGENT_ROLES, type AgentRole } from '../../agents/types.js';
import { WorkflowError } from '../errors.js';
import { externalAgentSchema } from '../../agents/external.js';

/** Commands a step can run after its agent finishes. */
export const STEP_CHECKS = ['format', 'lint', 'test'] as const;
export type StepCheck = (typeof STEP_CHECKS)[number];

const stepIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, 'must be lowercase letters, digits, and dashes, starting with a letter');

export const workflowStepSchema = z.object({
    /** Unique step id, used by onFail / next. */
    id: stepIdSchema,
    /** Agent role that runs this step (or use `uses` for a plugin step). */
    agent: z.enum(ALL_AGENT_ROLES as unknown as [AgentRole, ...AgentRole[]]).optional(),
    /** Plugin step to run instead of an agent: `<plugin-name>/<step-name>`. */
    uses: z.string().regex(/^[a-z0-9@][a-z0-9@._/-]*\/[a-z][a-z0-9-]*$/, 'must be "<plugin-name>/<step-name>"').optional(),
    /** Options passed to a plugin step. */
    with: z.record(z.unknown()).optional(),
    /** Shown in `workflow show` and dry runs. */
    description: z.string().optional(),
    /** `on-fail` steps run only when another step routes to them. */
    trigger: z.enum(['always', 'on-fail']).default('always'),
    /** Commands to run after the agent. `format` never fails; `lint` and `test` route to onFail. */
    checks: z.array(z.enum(STEP_CHECKS)).default([]),
    /** `verdict`: a negative verdict from a judging agent routes to onFail. */
    gate: z.enum(['verdict']).optional(),
    /** Step to run when a check or gate fails (one fix iteration). Without it, a failure ends the run as failed. */
    onFail: stepIdSchema.optional(),
    /** Step to run after this one succeeds (default: the next `always` step). */
    next: stepIdSchema.optional(),
    /** Pause for human review of this step's output (approve / edit / regenerate). */
    approval: z.boolean().default(false),
    /** Max model turns that may request tools, overriding the agent config. */
    maxTurns: z.number().int().min(1).max(100).optional(),
    /** Run this coder/fixer/tester step with another agent CLI instead of aiagentflow's agent. */
    external: externalAgentSchema.optional(),
});

export const workflowDefinitionSchema = z.object({
    name: stepIdSchema,
    description: z.string().default(''),
    /** Fix iterations allowed before the run fails (default: workflow.maxIterations from config). */
    maxIterations: z.number().int().min(1).max(50).optional(),
    steps: z.array(workflowStepSchema).min(1),
}).superRefine((wf, ctx) => {
    const ids = new Set<string>();
    wf.steps.forEach((step, i) => {
        if (ids.has(step.id)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps', i, 'id'], message: `duplicate step id "${step.id}"` });
        }
        ids.add(step.id);
    });

    wf.steps.forEach((step, i) => {
        for (const key of ['onFail', 'next'] as const) {
            const target = step[key];
            if (target && !ids.has(target)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps', i, key], message: `unknown step "${target}"` });
            }
        }
        if ((step.agent === undefined) === (step.uses === undefined)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps', i], message: 'needs exactly one of "agent" or "uses"' });
        }
        if (step.gate === 'verdict' && !['reviewer', 'security', 'judge'].includes(step.agent ?? '')) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps', i, 'gate'], message: `${step.agent ? `agent "${step.agent}"` : 'a plugin step'} does not return a verdict` });
        }
        if (step.uses && step.maxTurns !== undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps', i, 'maxTurns'], message: 'only applies to agent steps' });
        }
        if (step.external && !['coder', 'fixer', 'tester'].includes(step.agent ?? '')) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps', i, 'external'], message: 'only coder, fixer, and tester steps can run an external agent' });
        }
        if (step.agent && step.with !== undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps', i, 'with'], message: 'only applies to plugin steps ("uses")' });
        }
    });

    if (!wf.steps.some(s => s.trigger === 'always')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: 'at least one step must have trigger "always"' });
    }
});

export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

/**
 * Parse and validate a YAML workflow definition.
 *
 * @param source - where the YAML came from, for error messages
 * @throws {WorkflowError} with every validation problem listed
 */
export function parseWorkflow(yamlText: string, source: string): WorkflowDefinition {
    let raw: unknown;
    try {
        raw = parseYaml(yamlText);
    } catch (err) {
        throw new WorkflowError(`${source}: invalid YAML: ${err instanceof Error ? err.message : String(err)}`, { source });
    }

    const result = workflowDefinitionSchema.safeParse(raw);
    if (!result.success) {
        const problems = result.error.issues.map(i => `  - ${formatPath(i.path)}: ${i.message}`).join('\n');
        throw new WorkflowError(`${source}: invalid workflow\n${problems}`, { source });
    }
    return result.data;
}

/** The step that follows `step` in normal order, skipping on-fail steps. */
export function nextStep(wf: WorkflowDefinition, step: WorkflowStep): WorkflowStep | undefined {
    if (step.next) return stepById(wf, step.next);
    const index = wf.steps.indexOf(step);
    return wf.steps.slice(index + 1).find(s => s.trigger === 'always');
}

/** The first step of the workflow. */
export function firstStep(wf: WorkflowDefinition): WorkflowStep {
    return wf.steps.find(s => s.trigger === 'always')!;
}

export function stepById(wf: WorkflowDefinition, id: string): WorkflowStep | undefined {
    return wf.steps.find(s => s.id === id);
}

function formatPath(path: ReadonlyArray<string | number>): string {
    return path.length === 0 ? '(root)' : path.map(p => (typeof p === 'number' ? `[${p}]` : `.${p}`)).join('').replace(/^\./, '');
}

/** Display name of what a step runs: the agent role or the plugin step reference. */
export function stepRunner(step: WorkflowStep): string {
    return step.agent ?? step.uses ?? '?';
}
