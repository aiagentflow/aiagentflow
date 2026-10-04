import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateProject, migrateConfigObject, v1PromptIssue } from '../../../src/core/config/migrate.js';
import { loadConfig } from '../../../src/core/config/manager.js';
import { ConfigError } from '../../../src/core/errors.js';
import { V1_PROMPTS, defaultPrompt } from '../../../src/prompts/library.js';

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'v1');
let root: string;
const configPath = () => join(root, '.aiagentflow', 'config.json');
const promptPath = (role: string) => join(root, '.aiagentflow', 'prompts', `${role}.md`);

function useFixture(name: string) {
    mkdirSync(join(root, '.aiagentflow', 'prompts'), { recursive: true });
    copyFileSync(join(FIXTURES, name), configPath());
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'aiagentflow-migrate-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('v1 detection', () => {
    it('refuses to load a v1 config with an actionable error', () => {
        useFixture('default-config.json');
        expect(() => loadConfig(root)).toThrow(ConfigError);
        expect(() => loadConfig(root)).toThrow('Run "aiagentflow migrate"');
    });
});

describe('migrateProject on real v1.x configs', () => {
    it.each(['default-config.json', 'anthropic-config.json'])('%s becomes a loadable v2 config with nothing lost', (fixture) => {
        useFixture(fixture);
        const original = JSON.parse(readFileSync(configPath(), 'utf-8'));

        const report = migrateProject(root);

        expect(report.needed).toBe(true);
        const config = loadConfig(root);
        expect(config.version).toBe(2);
        expect(config.workflow).not.toHaveProperty('mode');
        expect(config.permissions.mode).toBe('ask');
        expect(config.workflow.legacyFileBlocks).toBe(false);
        // Everything the user set survives
        expect(config.agents).toMatchObject(original.agents);
        expect(config.providers).toMatchObject(original.providers);
        const { mode: _mode, ...workflowWithoutMode } = original.workflow;
        expect(config.workflow).toMatchObject(workflowWithoutMode);
        expect(config.mcpServers).toEqual(original.mcpServers);
        // The original is backed up
        expect(JSON.parse(readFileSync(join(report.backupDir!, 'config.json'), 'utf-8'))).toEqual(original);
    });

    it('is idempotent', () => {
        useFixture('default-config.json');
        migrateProject(root);
        const second = migrateProject(root);
        expect(second.needed).toBe(false);
        expect(readdirSync(join(root, '.aiagentflow')).filter(f => f.startsWith('backup-v1-'))).toHaveLength(1);
    });

    it('does not write anything on a dry run', () => {
        useFixture('anthropic-config.json');
        const before = readFileSync(configPath(), 'utf-8');
        const report = migrateProject(root, { dryRun: true });
        expect(report.configChanges[0]).toBe('version: 1 → 2');
        expect(report.configChanges).toContain('Removed workflow.mode ("strict"); its settings are already in the config, and --mode is deprecated');
        expect(readFileSync(configPath(), 'utf-8')).toBe(before);
        expect(report.backupDir).toBeUndefined();
    });

    it('upgrades untouched v1 prompts and flags customised ones', () => {
        useFixture('default-config.json');
        writeFileSync(promptPath('coder'), V1_PROMPTS.coder);
        writeFileSync(promptPath('reviewer'), V1_PROMPTS.reviewer);
        writeFileSync(promptPath('fixer'), '# My fixer\nAlways answer with\nFILE: path\n```\ncode\n```\n');
        writeFileSync(promptPath('judge'), '# Strict judge\n1. **Verdict**: PASS or FAIL\n');
        writeFileSync(promptPath('architect'), '# Custom architect, fine as is\n');

        const report = migrateProject(root);

        expect(report.promptsUpgraded.sort()).toEqual(['coder', 'reviewer']);
        expect(readFileSync(promptPath('coder'), 'utf-8')).toBe(defaultPrompt('coder'));
        expect(report.promptsToReview.map(p => p.role).sort()).toEqual(['fixer', 'judge']);
        // Customised prompts are left alone, and backed up with the rest
        expect(readFileSync(promptPath('fixer'), 'utf-8')).toContain('# My fixer');
        expect(existsSync(join(report.backupDir!, 'prompts', 'coder.md'))).toBe(true);
    });
});

describe('migrateConfigObject', () => {
    it('keeps an existing permissions section and handles configs without a version', () => {
        const { config, changes } = migrateConfigObject({ providers: {}, agents: {}, workflow: {}, permissions: { mode: 'auto' } });
        expect(config).toMatchObject({ version: 2, permissions: { mode: 'auto' } });
        expect(changes[0]).toBe('version: 1 → 2');
    });
});

describe('v1PromptIssue', () => {
    it('only flags v1 conventions', () => {
        expect(v1PromptIssue('coder', 'Use edit_file.')).toBeUndefined();
        expect(v1PromptIssue('reviewer', '**Verdict**: then call submit_verdict')).toBeUndefined();
        expect(v1PromptIssue('architect', 'FILE: whatever')).toBeUndefined();
    });
});
