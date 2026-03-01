/**
 * Tests for the config Zod schemas.
 *
 * Verifies that valid configs pass and invalid configs are rejected
 * with correct error messages.
 */

import { describe, it, expect } from 'vitest';
import {
    appConfigSchema,
    agentRoleConfigSchema,
    providerConfigSchema,
    workflowConfigSchema,
    projectConfigSchema,
} from '../../../src/core/config/schema.js';

describe('agentRoleConfigSchema', () => {
    it('accepts a valid agent role config', () => {
        const result = agentRoleConfigSchema.safeParse({
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            temperature: 0.7,
            maxTokens: 4096,
        });
        expect(result.success).toBe(true);
    });

    it('applies defaults for temperature and maxTokens', () => {
        const result = agentRoleConfigSchema.safeParse({
            provider: 'ollama',
            model: 'llama3.2:latest',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.temperature).toBe(0.7);
            expect(result.data.maxTokens).toBe(4096);
        }
    });

    it('rejects invalid provider', () => {
        const result = agentRoleConfigSchema.safeParse({
            provider: 'invalid-provider',
            model: 'gpt-4',
        });
        expect(result.success).toBe(false);
    });

    it('accepts gemini as a valid provider', () => {
        const result = agentRoleConfigSchema.safeParse({
            provider: 'gemini',
            model: 'gemini-2.0-flash',
        });
        expect(result.success).toBe(true);
    });

    it('rejects empty model string', () => {
        const result = agentRoleConfigSchema.safeParse({
            provider: 'anthropic',
            model: '',
        });
        expect(result.success).toBe(false);
    });

    it('rejects temperature out of range', () => {
        const result = agentRoleConfigSchema.safeParse({
            provider: 'ollama',
            model: 'llama3.2:latest',
            temperature: 3.0,
        });
        expect(result.success).toBe(false);
    });
});

describe('providerConfigSchema', () => {
    it('accepts empty providers (both optional)', () => {
        const result = providerConfigSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    it('accepts anthropic config with required fields', () => {
        const result = providerConfigSchema.safeParse({
            anthropic: { apiKey: 'sk-ant-test-key-12345678' },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.anthropic?.baseUrl).toBe('https://api.anthropic.com');
        }
    });

    it('rejects anthropic without apiKey', () => {
        const result = providerConfigSchema.safeParse({
            anthropic: {},
        });
        expect(result.success).toBe(false);
    });

    it('accepts gemini config with required fields', () => {
        const result = providerConfigSchema.safeParse({
            gemini: { apiKey: 'AIzaSy-test-key-12345678' },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.gemini?.baseUrl).toBe('https://generativelanguage.googleapis.com');
        }
    });

    it('accepts ollama with defaults', () => {
        const result = providerConfigSchema.safeParse({
            ollama: {},
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.ollama?.baseUrl).toBe('http://localhost:11434');
        }
    });
});

describe('workflowConfigSchema', () => {
    it('applies all defaults', () => {
        const result = workflowConfigSchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.maxIterations).toBe(5);
            expect(result.data.humanApproval).toBe(true);
            expect(result.data.autoCreateBranch).toBe(true);
            expect(result.data.branchPrefix).toBe('aiagentflow/');
            expect(result.data.autoRunTests).toBe(true);
        }
    });

    it('rejects maxIterations over 20', () => {
        const result = workflowConfigSchema.safeParse({ maxIterations: 50 });
        expect(result.success).toBe(false);
    });
});

describe('projectConfigSchema', () => {
    it('applies all defaults', () => {
        const result = projectConfigSchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.language).toBe('typescript');
            expect(result.data.framework).toBe('none');
            expect(result.data.testFramework).toBe('vitest');
        }
    });
});

describe('appConfigSchema', () => {
    it('accepts a complete valid config', () => {
        const validConfig = {
            version: 1,
            providers: {
                ollama: { baseUrl: 'http://localhost:11434' },
            },
            agents: {
                architect: { provider: 'ollama', model: 'llama3.2:latest' },
                coder: { provider: 'ollama', model: 'llama3.2:latest' },
                reviewer: { provider: 'ollama', model: 'llama3.2:latest' },
                tester: { provider: 'ollama', model: 'llama3.2:latest' },
                fixer: { provider: 'ollama', model: 'llama3.2:latest' },
                judge: { provider: 'ollama', model: 'llama3.2:latest' },
            },
            project: {},
            workflow: {},
        };

        const result = appConfigSchema.safeParse(validConfig);
        expect(result.success).toBe(true);
    });

    it('rejects wrong version number', () => {
        const result = appConfigSchema.safeParse({
            version: 2,
            providers: {},
            agents: {
                architect: { provider: 'ollama', model: 'test' },
                coder: { provider: 'ollama', model: 'test' },
                reviewer: { provider: 'ollama', model: 'test' },
                tester: { provider: 'ollama', model: 'test' },
                fixer: { provider: 'ollama', model: 'test' },
                judge: { provider: 'ollama', model: 'test' },
            },
            project: {},
            workflow: {},
        });
        expect(result.success).toBe(false);
    });

    it('rejects missing agents', () => {
        const result = appConfigSchema.safeParse({
            version: 1,
            providers: {},
            agents: {
                architect: { provider: 'ollama', model: 'test' },
                // missing other agents
            },
            project: {},
            workflow: {},
        });
        expect(result.success).toBe(false);
    });
});
