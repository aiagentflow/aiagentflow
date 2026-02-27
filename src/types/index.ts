/**
 * Global shared types re-exported from a single entry point.
 *
 * Dependency direction: types/index.ts → nothing (leaf module)
 * Used by: every layer that needs shared type definitions
 */

// Re-export all error types
export {
    AppError,
    ConfigError,
    ProviderError,
    GitError,
    WorkflowError,
    ValidationError,
} from '../core/errors.js';

// Re-export config types
export type {
    AppConfig,
    ProviderConfig,
    ProjectConfig,
    WorkflowConfig,
    AgentConfig,
    AgentRoleConfig,
} from '../core/config/types.js';

// Re-export provider types
export type {
    LLMProvider,
    ChatMessage,
    ChatOptions,
    ChatResponse,
    ChatChunk,
    ModelInfo,
    LLMProviderName,
} from '../providers/types.js';

// Re-export agent types
export type { AgentRole } from '../agents/types.js';
