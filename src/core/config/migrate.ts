/**
 * Upgrade a project from aiagentflow v1 to v2.
 *
 * - Backs up .aiagentflow/config.json and .aiagentflow/prompts/ first
 * - Converts the config to version 2: drops the deprecated `workflow.mode`
 *   and writes the new sections (permissions, repo map, legacy mode) with
 *   their defaults so they are visible and editable
 * - Replaces prompt files that are still the untouched v1 defaults
 * - Reports customised prompts that still use v1 conventions (FILE: blocks,
 *   text verdicts); those are left alone for the user to update
 *
 * Dependency direction: migrate.ts → config/schema, config/defaults, prompts/library, node:fs
 * Used by: cli/commands/migrate.ts
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_AGENT_ROLES, type AgentRole } from '../../agents/types.js';
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME, DEFAULT_CONFIG } from './defaults.js';
import { CONFIG_VERSION } from './schema.js';
import { defaultPrompt, getPromptsDir, V1_PROMPTS } from '../../prompts/library.js';
import { ConfigError } from '../errors.js';

export interface MigrationReport {
    /** False if the project was already on the current version. */
    needed: boolean;
    /** Where the originals were copied (undefined on a dry run). */
    backupDir?: string;
    /** Human-readable config changes. */
    configChanges: string[];
    /** Prompt files replaced because they were untouched v1 defaults. */
    promptsUpgraded: AgentRole[];
    /** Customised prompt files that still use v1 conventions, with the reason. */
    promptsToReview: Array<{ role: AgentRole; reason: string }>;
}

type JsonObject = Record<string, unknown>;

/**
 * Convert a v1 config object to v2. Pure: returns a new object and the list of changes.
 */
export function migrateConfigObject(v1: JsonObject): { config: JsonObject; changes: string[] } {
    const changes: string[] = [];
    const workflow = { ...((v1.workflow as JsonObject | undefined) ?? {}) };

    if ('mode' in workflow) {
        changes.push(`Removed workflow.mode ("${String(workflow.mode)}"); its settings are already in the config, and --mode is deprecated`);
        delete workflow.mode;
    }
    if (!('legacyFileBlocks' in workflow)) {
        workflow.legacyFileBlocks = false;
        changes.push('Added workflow.legacyFileBlocks: false (agents edit files through tools)');
    }

    const project = { ...((v1.project as JsonObject | undefined) ?? {}) };
    if (!('repoMapTokens' in project)) {
        project.repoMapTokens = DEFAULT_CONFIG.project.repoMapTokens;
        changes.push(`Added project.repoMapTokens: ${DEFAULT_CONFIG.project.repoMapTokens}`);
    }

    const permissions = v1.permissions ?? structuredClone(DEFAULT_CONFIG.permissions);
    if (!v1.permissions) changes.push('Added permissions (run_command policy and per-role tools) with defaults');

    changes.unshift(`version: ${String(v1.version ?? 1)} → ${CONFIG_VERSION}`);

    return {
        config: { ...v1, version: CONFIG_VERSION, project, workflow, permissions },
        changes,
    };
}

/** Why a customised prompt still looks like v1, or undefined if it looks fine. */
export function v1PromptIssue(role: AgentRole, prompt: string): string | undefined {
    if (['coder', 'tester', 'fixer'].includes(role) && /^FILE:/m.test(prompt)) {
        return 'asks for whole files as FILE: blocks; v2 agents edit through tools (read_file, edit_file, write_file)';
    }
    if (['reviewer', 'security', 'judge'].includes(role) && !prompt.includes('submit_verdict') && /\*\*Verdict\*\*/.test(prompt)) {
        return 'asks for a text verdict; v2 judging agents must call the submit_verdict tool';
    }
    return undefined;
}

/**
 * Upgrade the project at `projectRoot`.
 *
 * @throws {ConfigError} if there is no config or it is not valid JSON
 */
export function migrateProject(projectRoot: string, options: { dryRun?: boolean } = {}): MigrationReport {
    const configDir = join(projectRoot, CONFIG_DIR_NAME);
    const configPath = join(configDir, CONFIG_FILE_NAME);
    if (!existsSync(configPath)) {
        throw new ConfigError('No configuration found. Run "aiagentflow init" first.', { configPath });
    }

    let raw: JsonObject;
    try {
        raw = JSON.parse(readFileSync(configPath, 'utf-8')) as JsonObject;
    } catch (err) {
        throw new ConfigError(`${configPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, { configPath });
    }

    const report: MigrationReport = { needed: false, configChanges: [], promptsUpgraded: [], promptsToReview: [] };
    const configNeeded = raw.version !== CONFIG_VERSION;

    const promptsDir = getPromptsDir(projectRoot);
    const promptFiles = existsSync(promptsDir) ? readdirSync(promptsDir) : [];
    for (const role of ALL_AGENT_ROLES) {
        if (!promptFiles.includes(`${role}.md`)) continue;
        const text = readFileSync(join(promptsDir, `${role}.md`), 'utf-8');
        if (text.trim() === V1_PROMPTS[role].trim()) {
            report.promptsUpgraded.push(role);
        } else {
            const reason = v1PromptIssue(role, text);
            if (reason) report.promptsToReview.push({ role, reason });
        }
    }

    report.needed = configNeeded || report.promptsUpgraded.length > 0;
    const migrated = configNeeded ? migrateConfigObject(raw) : undefined;
    report.configChanges = migrated?.changes ?? [];
    if (!report.needed || options.dryRun) return report;

    // Back up everything we are about to change
    const backupDir = join(configDir, `backup-v1-${timestamp()}`);
    mkdirSync(backupDir, { recursive: true });
    copyFileSync(configPath, join(backupDir, CONFIG_FILE_NAME));
    if (existsSync(promptsDir)) cpSync(promptsDir, join(backupDir, 'prompts'), { recursive: true });
    report.backupDir = backupDir;

    if (migrated) writeFileSync(configPath, `${JSON.stringify(migrated.config, null, 2)}\n`);
    for (const role of report.promptsUpgraded) {
        writeFileSync(join(promptsDir, `${role}.md`), defaultPrompt(role));
    }

    return report;
}

function timestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
