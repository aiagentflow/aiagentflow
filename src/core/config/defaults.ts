/**
 * Default configuration values.
 *
 * These are sensible defaults for a new project. The init wizard
 * will override these based on user choices.
 *
 * Dependency direction: defaults.ts → types.ts
 * Used by: manager.ts, init.ts
 */

import type { AppConfig } from './types.js';

/**
 * Default agent role config — uses Ollama with a local model.
 * This is the safe default that doesn't require paid API keys.
 */
const DEFAULT_AGENT_ROLE = {
    provider: 'ollama' as const,
    model: 'llama3.2:latest',
    temperature: 0.7,
    maxTokens: 4096,
};

/**
 * Full default configuration.
 *
 * Key design decision: defaults to Ollama so users can start
 * without any API keys. Anthropic is opt-in via the init wizard.
 */
export const DEFAULT_CONFIG: AppConfig = {
    version: 1,

    providers: {
        ollama: {
            baseUrl: 'http://localhost:11434',
        },
    },

    agents: {
        architect: { ...DEFAULT_AGENT_ROLE, temperature: 0.5 },
        coder: { ...DEFAULT_AGENT_ROLE, temperature: 0.3, maxTokens: 8192 },
        reviewer: { ...DEFAULT_AGENT_ROLE, temperature: 0.4 },
        tester: { ...DEFAULT_AGENT_ROLE, temperature: 0.3 },
        fixer: { ...DEFAULT_AGENT_ROLE, temperature: 0.3, maxTokens: 8192 },
        judge: { ...DEFAULT_AGENT_ROLE, temperature: 0.2 },
    },

    project: {
        language: 'typescript',
        framework: 'none',
        testFramework: 'vitest',
        sourceGlobs: ['src/**/*.ts'],
        testGlobs: ['tests/**/*.test.ts'],
    },

    workflow: {
        mode: 'balanced' as const,
        maxIterations: 5,
        humanApproval: true,
        autoCreateBranch: true,
        branchPrefix: 'aiagentflow/',
        autoRunTests: true,
        autoCommit: false,
        autoCommitMessage: 'ai: {task}',
    },
};

/** The directory name where config is stored inside a project. */
export const CONFIG_DIR_NAME = '.aiagentflow';

/** The config file name. */
export const CONFIG_FILE_NAME = 'config.json';

/**
 * Workflow mode presets.
 *
 * Each preset bundles workflow settings and agent temperature overrides
 * for a common use case: speed, quality, or the default balance.
 */
export type WorkflowMode = 'fast' | 'balanced' | 'strict';

export interface WorkflowPreset {
    maxIterations: number;
    humanApproval: boolean;
    autoCommit: boolean;
    temperatures: Record<string, number>;
}

export const WORKFLOW_PRESETS: Record<WorkflowMode, WorkflowPreset> = {
    fast: {
        maxIterations: 3,
        humanApproval: false,
        autoCommit: true,
        temperatures: {
            architect: 0.7,
            coder: 0.5,
            reviewer: 0.6,
            tester: 0.5,
            fixer: 0.5,
            judge: 0.4,
        },
    },
    balanced: {
        maxIterations: 5,
        humanApproval: true,
        autoCommit: false,
        temperatures: {
            architect: 0.5,
            coder: 0.3,
            reviewer: 0.4,
            tester: 0.3,
            fixer: 0.3,
            judge: 0.2,
        },
    },
    strict: {
        maxIterations: 10,
        humanApproval: true,
        autoCommit: false,
        temperatures: {
            architect: 0.4,
            coder: 0.2,
            reviewer: 0.3,
            tester: 0.2,
            fixer: 0.2,
            judge: 0.1,
        },
    },
};
