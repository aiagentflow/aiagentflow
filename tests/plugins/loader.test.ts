/**
 * Tests for plugin loader validation logic.
 */

import { describe, it, expect } from 'vitest';
import { RESERVED_AGENT_ROLES, RESERVED_PROVIDER_NAMES } from '../../src/plugins/types.js';

describe('Plugin reserved names', () => {
    it('reserved agent roles includes all built-in roles', () => {
        const expected = ['architect', 'coder', 'reviewer', 'security', 'tester', 'fixer', 'judge'];
        for (const role of expected) {
            expect(RESERVED_AGENT_ROLES).toContain(role);
        }
    });

    it('reserved provider names includes all built-in providers', () => {
        const expected = ['anthropic', 'openai', 'gemini', 'groq', 'ollama', 'openrouter'];
        for (const name of expected) {
            expect(RESERVED_PROVIDER_NAMES).toContain(name);
        }
    });

    it('custom role names do not clash with reserved roles', () => {
        const customRoles = ['linter', 'performance-analyst', 'doc-writer'];
        for (const role of customRoles) {
            expect(RESERVED_AGENT_ROLES).not.toContain(role);
        }
    });
});

describe('PluginRegistry', () => {
    it('returns empty contributions with no plugins loaded', async () => {
        const { PluginRegistry } = await import('../../src/plugins/registry.js');
        const registry = new PluginRegistry();
        // No load() call — should return empty arrays
        expect(registry.getAgents()).toHaveLength(0);
        expect(registry.getProviders()).toHaveLength(0);
        expect(registry.pluginCount).toBe(0);
    });

    it('getAgent returns undefined for unknown role', async () => {
        const { PluginRegistry } = await import('../../src/plugins/registry.js');
        const registry = new PluginRegistry();
        expect(registry.getAgent('nonexistent')).toBeUndefined();
    });

    it('getProvider returns undefined for unknown name', async () => {
        const { PluginRegistry } = await import('../../src/plugins/registry.js');
        const registry = new PluginRegistry();
        expect(registry.getProvider('nonexistent')).toBeUndefined();
    });
});
