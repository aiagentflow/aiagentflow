/**
 * Zod schemas defining the complete configuration shape.
 *
 * This is the authoritative definition of what a valid config looks like.
 * All TypeScript types are inferred from these schemas via z.infer<>.
 *
 * Dependency direction: schema.ts → zod, agents/types.ts
 * Used by: manager.ts, init.ts, types.ts
 */

import { z } from 'zod';

/**
 * Schema for a single agent role's configuration.
 */
export const agentRoleConfigSchema = z.object({
    /** Which provider to use for this agent role. */
    provider: z.enum(['anthropic', 'ollama', 'openai']),
    /** The model identifier to use. */
    model: z.string().min(1),
    /** Sampling temperature (0.0 = deterministic, higher = more creative). */
    temperature: z.number().min(0).max(2).default(0.7),
    /** Maximum tokens the model can generate in a response. */
    maxTokens: z.number().int().min(1).max(200000).default(4096),
});

/**
 * Schema for all agent configurations, keyed by role.
 */
export const agentConfigSchema = z.object({
    architect: agentRoleConfigSchema,
    coder: agentRoleConfigSchema,
    reviewer: agentRoleConfigSchema,
    tester: agentRoleConfigSchema,
    fixer: agentRoleConfigSchema,
    judge: agentRoleConfigSchema,
});

/**
 * Schema for Anthropic provider settings.
 */
export const anthropicProviderSchema = z.object({
    apiKey: z.string().min(1, 'Anthropic API key is required'),
    baseUrl: z.string().url().default('https://api.anthropic.com'),
    apiVersion: z.string().default('2023-06-01'),
});

/**
 * Schema for Ollama provider settings.
 */
export const ollamaProviderSchema = z.object({
    baseUrl: z.string().url().default('http://localhost:11434'),
});

/**
 * Schema for OpenAI provider settings.
 */
export const openaiProviderSchema = z.object({
    apiKey: z.string().min(1, 'OpenAI API key is required'),
    baseUrl: z.string().url().default('https://api.openai.com'),
    organization: z.string().optional(),
});

/**
 * Schema for provider configuration (all providers).
 */
export const providerConfigSchema = z.object({
    anthropic: anthropicProviderSchema.optional(),
    ollama: ollamaProviderSchema.optional(),
    openai: openaiProviderSchema.optional(),
});

/**
 * Schema for project-level settings.
 */
export const projectConfigSchema = z.object({
    /** Primary programming language. */
    language: z.string().default('typescript'),
    /** Framework in use (e.g., "next.js", "express", "none"). */
    framework: z.string().default('none'),
    /** Test runner / framework (e.g., "vitest", "jest", "pytest"). */
    testFramework: z.string().default('vitest'),
    /** Glob patterns for source files. */
    sourceGlobs: z.array(z.string()).default(['src/**/*.ts']),
    /** Glob patterns for test files. */
    testGlobs: z.array(z.string()).default(['tests/**/*.test.ts']),
});

/**
 * Schema for workflow execution settings.
 */
export const workflowConfigSchema = z.object({
    /** Maximum number of fix iterations before stopping. */
    maxIterations: z.number().int().min(1).max(20).default(5),
    /** Whether to require human approval between stages. */
    humanApproval: z.boolean().default(true),
    /** Whether to auto-create a Git branch for each task. */
    autoCreateBranch: z.boolean().default(true),
    /** Branch name prefix for auto-created branches. */
    branchPrefix: z.string().default('aiagentflow/'),
    /** Whether to auto-run tests after code generation. */
    autoRunTests: z.boolean().default(true),
});

/**
 * The complete application configuration schema.
 * This is the single source of truth for config structure.
 */
export const appConfigSchema = z.object({
    /** Schema version for future migrations. */
    version: z.literal(1).default(1),
    /** LLM provider connection settings. */
    providers: providerConfigSchema,
    /** Per-agent model and parameter assignments. */
    agents: agentConfigSchema,
    /** Project-level settings. */
    project: projectConfigSchema,
    /** Workflow execution settings. */
    workflow: workflowConfigSchema,
});
