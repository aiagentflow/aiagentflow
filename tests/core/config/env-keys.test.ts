import { describe, it, expect } from 'vitest';
import { applyEnvApiKeys } from '../../../src/core/config/manager.js';
import { maskSecrets } from '../../../src/cli/commands/config.js';

describe('applyEnvApiKeys', () => {
    const base = {
        providers: { anthropic: { baseUrl: 'https://api.anthropic.com' }, openai: { apiKey: 'sk-from-file' } },
        agents: { coder: { provider: 'anthropic' }, reviewer: { provider: 'gemini' } },
    };

    it('fills missing keys from the environment and keeps keys from the file', () => {
        const out = applyEnvApiKeys(base, { ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-env' }) as typeof base;
        expect(out.providers.anthropic).toEqual({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant' });
        expect(out.providers.openai.apiKey).toBe('sk-from-file');
    });

    it('adds a provider section for agents that use it, using the first variable set', () => {
        const out = applyEnvApiKeys(base, { GOOGLE_API_KEY: 'g-key' }) as { providers: Record<string, unknown> };
        expect(out.providers.gemini).toEqual({ apiKey: 'g-key' });
        // groq is not used by any agent, so nothing is added
        expect(applyEnvApiKeys(base, { GROQ_API_KEY: 'x' })).not.toHaveProperty('providers.groq');
    });

    it('does not mutate the input or touch non-objects', () => {
        const copy = structuredClone(base);
        applyEnvApiKeys(base, { ANTHROPIC_API_KEY: 'sk-ant' });
        expect(base).toEqual(copy);
        expect(applyEnvApiKeys(null, {})).toBeNull();
    });
});

describe('maskSecrets', () => {
    it('masks API keys and token-like env values but not numbers', () => {
        const masked = maskSecrets({
            providers: { anthropic: { apiKey: 'sk-ant-1234567890' } },
            agents: { coder: { maxTokens: 8192 } },
            mcpServers: { github: { env: { GITHUB_TOKEN: 'ghp_secret', LOG_LEVEL: 'debug' } } },
        });
        expect(masked.providers.anthropic.apiKey).toBe('sk-a…********');
        expect(masked.agents.coder.maxTokens).toBe(8192);
        expect(masked.mcpServers.github.env).toEqual({ GITHUB_TOKEN: 'ghp_…********', LOG_LEVEL: 'debug' });
    });
});
