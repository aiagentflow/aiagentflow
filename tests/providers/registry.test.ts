/**
 * Tests for the provider registry (factory pattern).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    createProvider,
    clearProviderCache,
    getSupportedProviders,
} from '../../src/providers/registry.js';
import { ProviderError } from '../../src/core/errors.js';
import type { ProviderConfig } from '../../src/core/config/types.js';

beforeEach(() => {
    clearProviderCache();
});

describe('getSupportedProviders', () => {
    it('returns anthropic and ollama', () => {
        const providers = getSupportedProviders();
        expect(providers).toContain('anthropic');
        expect(providers).toContain('ollama');
        expect(providers.length).toBe(2);
    });
});

describe('createProvider', () => {
    it('creates an Ollama provider with default config', () => {
        const config: ProviderConfig = {
            ollama: { baseUrl: 'http://localhost:11434' },
        };

        const provider = createProvider('ollama', config);
        expect(provider.name).toBe('ollama');
    });

    it('creates an Anthropic provider with valid config', () => {
        const config: ProviderConfig = {
            anthropic: {
                apiKey: 'sk-ant-test-12345678',
                baseUrl: 'https://api.anthropic.com',
                apiVersion: '2023-06-01',
            },
        };

        const provider = createProvider('anthropic', config);
        expect(provider.name).toBe('anthropic');
    });

    it('throws ProviderError when Anthropic config is missing', () => {
        const config: ProviderConfig = {};

        expect(() => createProvider('anthropic', config)).toThrow(ProviderError);
    });

    it('caches provider instances', () => {
        const config: ProviderConfig = {
            ollama: { baseUrl: 'http://localhost:11434' },
        };

        const first = createProvider('ollama', config);
        const second = createProvider('ollama', config);
        expect(first).toBe(second);
    });

    it('returns fresh instances after cache clear', () => {
        const config: ProviderConfig = {
            ollama: { baseUrl: 'http://localhost:11434' },
        };

        const first = createProvider('ollama', config);
        clearProviderCache();
        const second = createProvider('ollama', config);
        expect(first).not.toBe(second);
    });

    it('throws for unknown provider name', () => {
        const config: ProviderConfig = {};
        expect(() => createProvider('openai' as any, config)).toThrow(ProviderError);
    });
});
