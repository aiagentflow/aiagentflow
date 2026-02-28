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
        maxIterations: 5,
        humanApproval: true,
        autoCreateBranch: true,
        branchPrefix: 'ai-agent-flow/',
        autoRunTests: true,
    },
};

/** The directory name where config is stored inside a project. */
export const CONFIG_DIR_NAME = '.ai-agent-flow';

/** The config file name. */
export const CONFIG_FILE_NAME = 'config.json';
