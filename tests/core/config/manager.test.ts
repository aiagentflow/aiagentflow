/**
 * Tests for the config manager (load, save, validate, merge).
 *
 * Uses a temp directory to simulate project configs on disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    loadConfig,
    saveConfig,
    configExists,
    getConfigPath,
    mergeConfig,
    getDefaultConfig,
} from '../../../src/core/config/manager.js';
import { DEFAULT_CONFIG, CONFIG_DIR_NAME, CONFIG_FILE_NAME } from '../../../src/core/config/defaults.js';
import { ConfigError } from '../../../src/core/errors.js';

let testDir: string;

beforeEach(() => {
    testDir = join(tmpdir(), `ai-agent-flow-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
    if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
    }
});

describe('configExists', () => {
    it('returns false when no config exists', () => {
        expect(configExists(testDir)).toBe(false);
    });

    it('returns true after saving config', () => {
        saveConfig(testDir, DEFAULT_CONFIG);
        expect(configExists(testDir)).toBe(true);
    });
});

describe('getConfigPath', () => {
    it('returns the correct path', () => {
        const expected = join(testDir, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
        expect(getConfigPath(testDir)).toBe(expected);
    });
});

describe('saveConfig', () => {
    it('saves valid config and creates directories', () => {
        saveConfig(testDir, DEFAULT_CONFIG);

        const configPath = getConfigPath(testDir);
        expect(existsSync(configPath)).toBe(true);
    });

    it('throws ConfigError for invalid config', () => {
        const invalidConfig = { ...DEFAULT_CONFIG, version: 99 as 1 };
        expect(() => saveConfig(testDir, invalidConfig)).toThrow(ConfigError);
    });
});

describe('loadConfig', () => {
    it('loads a previously saved config', () => {
        saveConfig(testDir, DEFAULT_CONFIG);
        const loaded = loadConfig(testDir);

        expect(loaded.version).toBe(1);
        expect(loaded.providers.ollama?.baseUrl).toBe('http://localhost:11434');
        expect(loaded.agents.architect.provider).toBe('ollama');
    });

    it('throws ConfigError when no config exists', () => {
        expect(() => loadConfig(testDir)).toThrow(ConfigError);
    });

    it('throws ConfigError for corrupted JSON', () => {
        const configDir = join(testDir, CONFIG_DIR_NAME);
        mkdirSync(configDir, { recursive: true });

        const { writeFileSync } = require('node:fs');
        writeFileSync(join(configDir, CONFIG_FILE_NAME), '{ broken json }', 'utf-8');

        expect(() => loadConfig(testDir)).toThrow(ConfigError);
    });
});

describe('mergeConfig', () => {
    it('overrides top-level values', () => {
        const result = mergeConfig(
            { version: 1 } as any,
            { version: 1 } as any,
        );
        expect(result.version).toBe(1);
    });

    it('deep merges nested objects', () => {
        const target = {
            workflow: { maxIterations: 5, humanApproval: true },
        };
        const source = {
            workflow: { maxIterations: 10 },
        };
        const result = mergeConfig(target as any, source as any);
        expect((result as any).workflow.maxIterations).toBe(10);
        expect((result as any).workflow.humanApproval).toBe(true);
    });

    it('replaces arrays instead of concatenating', () => {
        const target = {
            project: { sourceGlobs: ['src/**/*.ts'] },
        };
        const source = {
            project: { sourceGlobs: ['lib/**/*.js'] },
        };
        const result = mergeConfig(target as any, source as any);
        expect((result as any).project.sourceGlobs).toEqual(['lib/**/*.js']);
    });
});

describe('getDefaultConfig', () => {
    it('returns default config without overrides', () => {
        const config = getDefaultConfig();
        expect(config.version).toBe(1);
        expect(config.agents.architect.provider).toBe('ollama');
    });

    it('applies partial overrides', () => {
        const config = getDefaultConfig({
            workflow: { ...DEFAULT_CONFIG.workflow, maxIterations: 10 },
        });
        expect(config.workflow.maxIterations).toBe(10);
        expect(config.workflow.humanApproval).toBe(true);
    });
});
