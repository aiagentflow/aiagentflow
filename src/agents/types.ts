/**
 * Agent role type definitions.
 *
 * Dependency direction: agents/types.ts → nothing (leaf module)
 * Used by: config schemas, workflow engine, provider registry
 */

/** All supported agent roles in the workflow. */
export type AgentRole = 'architect' | 'coder' | 'reviewer' | 'tester' | 'fixer' | 'judge';

/** Display-friendly labels for each agent role. */
export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
    architect: '🧠 Architect',
    coder: '💻 Coder',
    reviewer: '🔍 Reviewer',
    tester: '🧪 Tester',
    fixer: '🐛 Fixer',
    judge: '✅ Judge',
};

/** All valid agent roles as an array (for iteration and validation). */
export const ALL_AGENT_ROLES: readonly AgentRole[] = [
    'architect',
    'coder',
    'reviewer',
    'tester',
    'fixer',
    'judge',
] as const;
