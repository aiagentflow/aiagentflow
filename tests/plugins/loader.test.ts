/**
 * Tests for plugin API v2: validation, loading, and the registry.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPlugin, validatePlugin } from '../../src/plugins/loader.js';
import { PluginRegistry } from '../../src/plugins/registry.js';
import { createProvider, clearProviderCache } from '../../src/providers/registry.js';
import type { PluginExports } from '../../src/plugins/types.js';

const manifest = { name: 'demo', version: '1.0.0', apiVersion: 2 as const };
const tool = (name: string) => ({ definition: { name, description: name, inputSchema: { type: 'object' } }, execute: async () => 'ok' });

describe('validatePlugin', () => {
    it('accepts a v2 plugin with tools, providers, and steps', () => {
        expect(() => validatePlugin({
            manifest,
            tools: [tool('count_todos')],
            providers: [{ name: 'echo', create: () => ({}) as never }],
            steps: [{ name: 'no-todos', run: async () => ({ passed: true, summary: '' }) }],
        })).not.toThrow();
    });

    it.each([
        [{ manifest: { name: 'demo', version: '1', type: 'agent' } }, /apiVersion must be 2\. This looks like a v1 plugin/],
        [{ manifest, agents: [] }, /"agents" is a v1 contribution/],
        [{ manifest, tools: [tool('read_file')] }, /tool "read_file" is built in/],
        [{ manifest, tools: [tool('submit_verdict')] }, /tool "submit_verdict" is built in/],
        [{ manifest, providers: [{ name: 'openai', create: () => ({}) }] }, /provider "openai" is built in/],
        [{ manifest, steps: [{ name: 'Bad Name', run: async () => ({}) }] }, /lowercase name/],
        [{ manifest: { ...manifest, name: 'Has Spaces' } }, /lowercase "name"/],
    ])('rejects %#', (exports, message) => {
        expect(() => validatePlugin(exports as unknown as Partial<PluginExports>)).toThrow(message);
    });
});

describe('loading and the registry', () => {
    let root: string;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'aiagentflow-plugin-'));
        clearProviderCache();
    });
    afterEach(() => {
        clearProviderCache();
        rmSync(root, { recursive: true, force: true });
    });

    function writePlugin(dir: string, source: string) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', type: 'module', main: 'index.js' }));
        writeFileSync(join(dir, 'index.js'), source);
    }

    it('loads a plugin from a local path', async () => {
        const dir = join(root, 'local');
        writePlugin(dir, 'export const manifest = { name: "local", version: "1.0.0", apiVersion: 2 };\n');
        const plugin = await loadPlugin(dir);
        expect(plugin).toMatchObject({ manifest: { name: 'local' }, tools: [], providers: [], steps: [], path: dir });
    });

    it('exposes tools by role, steps by reference, and registers providers', async () => {
        writePlugin(join(root, '.aiagentflow', 'plugins', 'demo'), `
            export const manifest = { name: 'demo', version: '1.0.0', apiVersion: 2 };
            export const tools = [
                { definition: { name: 'everyone', description: '', inputSchema: {} }, execute: async () => '' },
                { definition: { name: 'coders_only', description: '', inputSchema: {} }, roles: ['coder'], execute: async () => '' },
            ];
            export const steps = [{ name: 'check', run: async () => ({ passed: true, summary: 'ok' }) }];
            export const providers = [{
                name: 'echo',
                create: (config) => ({
                    name: 'echo',
                    chat: async () => ({ content: config.greeting ?? 'hi', model: 'echo', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop', stopReason: 'end_turn', toolCalls: [] }),
                    async *stream() {},
                    listModels: async () => [],
                    validateConnection: async () => true,
                }),
            }];
        `);

        const registry = new PluginRegistry();
        await registry.load(root);

        expect(registry.pluginCount).toBe(1);
        expect(registry.toolsFor('coder').map(t => t.definition.name)).toEqual(['everyone', 'coders_only']);
        expect(registry.toolsFor('reviewer').map(t => t.definition.name)).toEqual(['everyone']);
        expect(registry.step('demo/check')?.name).toBe('check');
        expect(registry.step('demo/missing')).toBeUndefined();
        expect(registry.stepRefs()).toEqual(['demo/check']);

        // The plugin provider is created from providers.<name> in the config
        const echo = createProvider('echo', { echo: { greeting: 'hello from config' } } as never);
        expect((await echo.chat([{ role: 'user', content: 'x' }])).content).toBe('hello from config');
    });

    it('reports unknown providers with the available names', () => {
        expect(() => createProvider('nope', {} as never)).toThrow(/Unknown provider: "nope"\. Available: anthropic, gemini/);
    });
});
