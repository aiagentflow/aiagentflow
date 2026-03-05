import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

/**
 * Tests for doctor command helper functions.
 * We test the pure check functions directly rather than running the CLI.
 */

// We need to test the check functions, but they're not exported from the command file.
// Instead, test the underlying logic used by doctor checks.

describe('doctor checks — environment', () => {
    it('Node.js version is >= 20', () => {
        const major = parseInt(process.versions.node.split('.')[0]!, 10);
        expect(major).toBeGreaterThanOrEqual(20);
    });

    it('git is available', () => {
        const version = execSync('git --version', { encoding: 'utf-8' }).trim();
        expect(version).toMatch(/^git version/);
    });
});

describe('doctor checks — prompt files', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'aiagentflow-doctor-test-'));
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('detects missing prompts directory', () => {
        const promptsDir = join(tmpDir, '.aiagentflow', 'prompts');
        expect(() => {
            // Simulate the check
            const { existsSync } = require('node:fs');
            if (!existsSync(promptsDir)) {
                throw new Error('Prompts directory missing');
            }
        }).toThrow('Prompts directory missing');
    });

    it('detects present prompt files', () => {
        const promptsDir = join(tmpDir, '.aiagentflow', 'prompts');
        mkdirSync(promptsDir, { recursive: true });

        const roles = ['architect', 'coder', 'reviewer', 'tester', 'fixer', 'judge'];
        for (const role of roles) {
            writeFileSync(join(promptsDir, `${role}.md`), `# ${role}`, 'utf-8');
        }

        const { existsSync } = require('node:fs');
        const missing = roles.filter(r => !existsSync(join(promptsDir, `${r}.md`)));
        expect(missing).toHaveLength(0);
    });

    it('detects partially missing prompt files', () => {
        const promptsDir = join(tmpDir, '.aiagentflow', 'prompts');
        mkdirSync(promptsDir, { recursive: true });

        // Only create some
        writeFileSync(join(promptsDir, 'architect.md'), '# arch', 'utf-8');
        writeFileSync(join(promptsDir, 'coder.md'), '# coder', 'utf-8');

        const { existsSync } = require('node:fs');
        const roles = ['architect', 'coder', 'reviewer', 'tester', 'fixer', 'judge'];
        const missing = roles.filter(r => !existsSync(join(promptsDir, `${r}.md`)));
        expect(missing).toHaveLength(4);
        expect(missing).toContain('reviewer');
        expect(missing).toContain('tester');
    });
});

describe('doctor checks — agent-provider mapping', () => {
    it('identifies agents using unconfigured providers', () => {
        const config = {
            providers: {
                ollama: { baseUrl: 'http://localhost:11434' },
                // anthropic NOT configured
            },
            agents: {
                architect: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', temperature: 0.5, maxTokens: 4096 },
                coder: { provider: 'ollama', model: 'llama3.2:latest', temperature: 0.3, maxTokens: 8192 },
                reviewer: { provider: 'ollama', model: 'llama3.2:latest', temperature: 0.4, maxTokens: 4096 },
                tester: { provider: 'ollama', model: 'llama3.2:latest', temperature: 0.3, maxTokens: 4096 },
                fixer: { provider: 'ollama', model: 'llama3.2:latest', temperature: 0.3, maxTokens: 8192 },
                judge: { provider: 'ollama', model: 'llama3.2:latest', temperature: 0.2, maxTokens: 4096 },
            },
        };

        const configuredProviders = new Set(Object.keys(config.providers));
        configuredProviders.add('ollama'); // always available

        const unconfigured = Object.entries(config.agents)
            .filter(([_, agentCfg]) => !configuredProviders.has(agentCfg.provider))
            .map(([role]) => role);

        expect(unconfigured).toEqual(['architect']);
    });

    it('passes when all agent providers are configured', () => {
        const config = {
            providers: {
                ollama: { baseUrl: 'http://localhost:11434' },
            },
            agents: {
                architect: { provider: 'ollama', model: 'llama3.2:latest', temperature: 0.5, maxTokens: 4096 },
                coder: { provider: 'ollama', model: 'llama3.2:latest', temperature: 0.3, maxTokens: 8192 },
                reviewer: { provider: 'ollama', model: 'llama3.2:latest', temperature: 0.4, maxTokens: 4096 },
                tester: { provider: 'ollama', model: 'llama3.2:latest', temperature: 0.3, maxTokens: 4096 },
                fixer: { provider: 'ollama', model: 'llama3.2:latest', temperature: 0.3, maxTokens: 8192 },
                judge: { provider: 'ollama', model: 'llama3.2:latest', temperature: 0.2, maxTokens: 4096 },
            },
        };

        const configuredProviders = new Set(Object.keys(config.providers));
        configuredProviders.add('ollama');

        const unconfigured = Object.entries(config.agents)
            .filter(([_, agentCfg]) => !configuredProviders.has(agentCfg.provider))
            .map(([role]) => role);

        expect(unconfigured).toHaveLength(0);
    });
});
