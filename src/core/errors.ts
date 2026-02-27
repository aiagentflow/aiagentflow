/**
 * Core error hierarchy for the AI Workflow Orchestrator.
 *
 * All errors extend AppError and carry a machine-readable code
 * plus optional structured context for debugging.
 *
 * Dependency direction: errors.ts → nothing (leaf module)
 * Used by: every layer in the application
 */

/** Base application error with structured metadata. */
export class AppError extends Error {
    public readonly code: string;
    public readonly context?: Record<string, unknown>;

    constructor(message: string, code: string, context?: Record<string, unknown>) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.context = context;

        // Maintains proper stack trace in V8
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

/** Raised when configuration is missing, invalid, or cannot be loaded/saved. */
export class ConfigError extends AppError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, 'CONFIG_ERROR', context);
        this.name = 'ConfigError';
    }
}

/** Raised when an LLM provider call fails or cannot be reached. */
export class ProviderError extends AppError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, 'PROVIDER_ERROR', context);
        this.name = 'ProviderError';
    }
}

/** Raised when a Git operation fails. */
export class GitError extends AppError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, 'GIT_ERROR', context);
        this.name = 'GitError';
    }
}

/** Raised when a workflow state transition is invalid. */
export class WorkflowError extends AppError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, 'WORKFLOW_ERROR', context);
        this.name = 'WorkflowError';
    }
}

/** Raised when user input fails validation. */
export class ValidationError extends AppError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, 'VALIDATION_ERROR', context);
        this.name = 'ValidationError';
    }
}
