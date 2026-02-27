/**
 * TypeScript types inferred from Zod schemas.
 *
 * NEVER define config types manually — they are always derived
 * from the Zod schemas to guarantee runtime and compile-time agreement.
 *
 * Dependency direction: types.ts → schema.ts
 * Used by: every module that touches config
 */

import { z } from 'zod';
import {
    agentConfigSchema,
    agentRoleConfigSchema,
    appConfigSchema,
    providerConfigSchema,
    projectConfigSchema,
    workflowConfigSchema,
} from './schema.js';

/** Complete application configuration. */
export type AppConfig = z.infer<typeof appConfigSchema>;

/** LLM provider connection settings. */
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/** Project-level settings (language, framework, test runner). */
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/** Workflow execution settings. */
export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;

/** Per-agent model and parameter assignments. */
export type AgentConfig = z.infer<typeof agentConfigSchema>;

/** Configuration for a single agent role. */
export type AgentRoleConfig = z.infer<typeof agentRoleConfigSchema>;
