/**
 * Agent role type definitions.
 *
 * Dependency direction: agents/types.ts → nothing (leaf module)
 * Used by: config schemas, workflow engine, provider registry
 */

/** All supported agent roles in the workflow. */
export type AgentRole = 'architect' | 'coder' | 'reviewer' | 'security' | 'tester' | 'fixer' | 'judge';

/** Display-friendly labels for each agent role. */
export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
    architect: '🧠 Architect',
    coder: '💻 Coder',
    reviewer: '🔍 Reviewer',
    security: '🔒 Security',
    tester: '🧪 Tester',
    fixer: '🐛 Fixer',
    judge: '✅ Judge',
};

/** Callbacks for streaming agent execution. */
export interface StreamCallbacks {
    /** Called for each text chunk as it arrives. */
    onChunk?: (text: string) => void;
    /** Called once when the full response is complete. */
    onComplete?: (fullText: string) => void;
}

/** All valid agent roles as an array (for iteration and validation). */
export const ALL_AGENT_ROLES: readonly AgentRole[] = [
    'architect',
    'coder',
    'reviewer',
    'security',
    'tester',
    'fixer',
    'judge',
] as const;
