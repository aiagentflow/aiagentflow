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

/** Current config format version. */
export const CONFIG_VERSION = 2;
import { BUILTIN_TOOL_NAMES, DEFAULT_DENY } from '../../tools/permissions.js';

/**
 * Schema for a single agent role's configuration.
 */
export const agentRoleConfigSchema = z.object({
    /** Which provider to use for this agent role: a built-in name or one contributed by a plugin. */
    provider: z.string().min(1),
    /** The model identifier to use. */
    model: z.string().min(1),
    /** Sampling temperature (0.0 = deterministic, higher = more creative). */
    temperature: z.number().min(0).max(2).default(0.7),
    /** Maximum tokens the model can generate in a response. */
    maxTokens: z.number().int().min(1).max(200000).default(16000),
    /** Max model turns that may request tools before a final answer is forced (default 10). */
    maxTurns: z.number().int().min(1).max(100).optional(),
});

/**
 * Schema for all agent configurations, keyed by role.
 */
export const agentConfigSchema = z.object({
    architect: agentRoleConfigSchema,
    coder: agentRoleConfigSchema,
    reviewer: agentRoleConfigSchema,
    security: agentRoleConfigSchema.default({ provider: 'ollama', model: 'llama3.2:latest', temperature: 0.2, maxTokens: 16000 }),
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
 * Schema for Google Gemini provider settings.
 */
export const geminiProviderSchema = z.object({
    apiKey: z.string().min(1, 'Gemini API key is required'),
    baseUrl: z.string().url().default('https://generativelanguage.googleapis.com'),
});

/**
 * Schema for Groq provider settings.
 */
export const groqProviderSchema = z.object({
    apiKey: z.string().min(1, 'Groq API key is required'),
    baseUrl: z.string().url().default('https://api.groq.com/openai/v1'),
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
/**
 * Schema for OpenRouter provider settings.
 */
export const openrouterProviderSchema = z.object({
    apiKey: z.string().min(1, 'OpenRouter API key is required'),
    baseUrl: z.string().url().default('https://openrouter.ai/api/v1'),
    siteUrl: z.string().optional(),
    siteName: z.string().optional(),
});

export const providerConfigSchema = z.object({
    anthropic: anthropicProviderSchema.optional(),
    gemini: geminiProviderSchema.optional(),
    groq: groqProviderSchema.optional(),
    ollama: ollamaProviderSchema.optional(),
    openai: openaiProviderSchema.optional(),
    openrouter: openrouterProviderSchema.optional(),
// Other keys configure plugin providers and are passed through as-is
}).catchall(z.record(z.unknown()));

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
    /** Token budget for the repository map given to agents (0 disables it). */
    repoMapTokens: z.number().int().min(0).max(50_000).default(4000),
});

/**
 * Schema for workflow execution settings.
 */
export const workflowConfigSchema = z.object({
    /** Deprecated (v1): set by the --mode flag at runtime; not needed in config files. */
    mode: z.enum(['fast', 'balanced', 'strict']).optional(),
    /** Maximum number of fix iterations before stopping. */
    maxIterations: z.number().int().min(1).max(20).default(5),
    /** Whether to require human approval between stages. */
    humanApproval: z.boolean().default(true),
    /** Which agent stages require explicit human approval before proceeding. */
    approvalGates: z.array(z.enum(['architect', 'coder', 'reviewer', 'security', 'tester', 'fixer', 'judge'])).default([]),
    /** Whether to auto-create a Git branch for each task. */
    autoCreateBranch: z.boolean().default(true),
    /** Branch name prefix for auto-created branches. */
    branchPrefix: z.string().default('aiagentflow/'),
    /**
     * 'worktree' (default) runs each task on its own branch in a separate git worktree, leaving
     * your working directory untouched; 'inplace' edits the working directory directly.
     * Projects that are not git repositories (or have no commits) always run in place.
     */
    isolation: z.enum(['worktree', 'inplace']).default('worktree'),
    /** When to merge the worktree branch back into the source branch. */
    autoMerge: z.enum(['never', 'on-judge-pass', 'always']).default('never'),
    /** Whether to auto-run tests after code generation. */
    autoRunTests: z.boolean().default(true),
    /** Custom test command override (e.g., 'go test ./...'). Derived from testFramework if not set. */
    testCommand: z.string().optional(),
    /** Lint command to run after code generation. Failures are fed to the Fixer. */
    lintCommand: z.string().optional(),
    /** Format command to run silently after file writes (e.g., 'prettier --write'). */
    formatCommand: z.string().optional(),
    /**
     * v1 behaviour: code-writing agents return whole files as `FILE:` blocks instead
     * of editing through tools. For models without tool support.
     */
    legacyFileBlocks: z.boolean().default(false),
    /** Whether to auto-commit changes when QA passes. */
    autoCommit: z.boolean().default(false),
    /** Commit message template. Supports {task} placeholder. */
    autoCommitMessage: z.string().default('ai: {task}'),
});

/**
 * Schema for tool permissions: what agents may run and which tools each role gets.
 */
export const permissionsConfigSchema = z.object({
    /** How run_command handles commands that match no allow/deny pattern. */
    mode: z.enum(['ask', 'auto', 'deny']).default('ask'),
    /** Command patterns that always run (`*` is a wildcard). Test/lint/format commands are added automatically. */
    allow: z.array(z.string()).default([]),
    /** Command patterns that never run. Defaults block privilege escalation, pushes, publishing, and network tools. */
    deny: z.array(z.string()).default([...DEFAULT_DENY]),
    /** Built-in tools per role, overriding the defaults (e.g. { "reviewer": ["read_file", "grep"] }). */
    tools: z.record(z.enum(['architect', 'coder', 'reviewer', 'security', 'tester', 'fixer', 'judge']), z.array(z.enum(BUILTIN_TOOL_NAMES))).default({}),
    /** Timeout for each run_command call, in milliseconds. */
    commandTimeoutMs: z.number().int().min(1000).max(3_600_000).default(120_000),
});

/**
 * Schema for a single MCP server entry.
 */
export const mcpServerConfigSchema = z.object({
    /** Command to run the server (e.g. "npx", "python"). */
    command: z.string().min(1),
    /** Arguments passed to the command. */
    args: z.array(z.string()).default([]),
    /** Additional environment variables for the server process. */
    env: z.record(z.string()).default({}),
    /** Agent roles allowed to use this server's tools. Default: all roles. */
    allowedRoles: z.array(z.string()).optional(),
});

/**
 * The complete application configuration schema.
 * This is the single source of truth for config structure.
 */
export const appConfigSchema = z.object({
    /** Config format version. v1 files must be upgraded with `aiagentflow migrate`. */
    version: z.literal(CONFIG_VERSION),
    /** LLM provider connection settings. */
    providers: providerConfigSchema,
    /** Per-agent model and parameter assignments. */
    agents: agentConfigSchema,
    /** Project-level settings. */
    project: projectConfigSchema,
    /** Workflow execution settings. */
    workflow: workflowConfigSchema,
    /** Tool permissions (run_command policy and per-role tool allowlists). */
    permissions: permissionsConfigSchema.default({}),
    /** MCP server definitions (optional). Keys are logical server names. */
    mcpServers: z.record(mcpServerConfigSchema).default({}),
});
