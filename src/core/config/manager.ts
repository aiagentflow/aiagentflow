/**
 * Configuration manager — load, save, validate, and merge configs.
 *
 * Dependency direction: manager.ts → schema.ts, defaults.ts, utils/fs.ts, errors.ts
 * Used by: CLI commands, workflow engine, provider registry
 */

import { join, resolve } from 'node:path';
import { appConfigSchema } from './schema.js';
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME, DEFAULT_CONFIG } from './defaults.js';
import type { AppConfig } from './types.js';
import { fileExists, readJsonFile, writeJsonFile, ensureDir } from '../../utils/fs.js';
import { ConfigError } from '../errors.js';
import { logger } from '../../utils/logger.js';

/**
 * Resolve the config directory path for a given project root.
 */
export function getConfigDir(projectRoot: string): string {
    return join(resolve(projectRoot), CONFIG_DIR_NAME);
}

/**
 * Resolve the full config file path for a given project root.
 */
export function getConfigPath(projectRoot: string): string {
    return join(getConfigDir(projectRoot), CONFIG_FILE_NAME);
}

/**
 * Check whether a config file exists in the given project root.
 */
export function configExists(projectRoot: string): boolean {
    return fileExists(getConfigPath(projectRoot));
}

/** Environment variables that supply provider API keys. The first one set wins. */
export const API_KEY_ENV_VARS: Readonly<Record<string, readonly string[]>> = {
    anthropic: ['ANTHROPIC_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    groq: ['GROQ_API_KEY'],
    gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY'],
};

/**
 * Fill provider API keys from the environment, so config.json can be
 * committed without secrets (e.g. in CI). A key in config.json wins over the
 * environment. Providers referenced by an agent but missing from `providers`
 * are added when their environment variable is set.
 */
export function applyEnvApiKeys(raw: unknown, env: NodeJS.ProcessEnv): unknown {
    if (!raw || typeof raw !== 'object') return raw;
    const config = raw as { providers?: Record<string, Record<string, unknown> | undefined>; agents?: Record<string, { provider?: string }> };
    const providers = { ...(config.providers ?? {}) };
    const used = new Set(Object.values(config.agents ?? {}).map(a => a?.provider));

    for (const [name, vars] of Object.entries(API_KEY_ENV_VARS)) {
        const fromEnv = vars.map(v => env[v]).find(Boolean);
        if (!fromEnv) continue;
        const section = providers[name];
        if (section && !section.apiKey) providers[name] = { ...section, apiKey: fromEnv };
        else if (!section && used.has(name)) providers[name] = { apiKey: fromEnv };
    }
    return { ...config, providers };
}

/**
 * Load and validate the configuration from disk.
 * Provider API keys may come from environment variables (see API_KEY_ENV_VARS).
 *
 * @param projectRoot - The root directory of the project (where .aiagentflow/ lives)
 * @returns The validated AppConfig
 * @throws {ConfigError} if the file doesn't exist, is invalid JSON, or fails validation
 */
export function loadConfig(projectRoot: string): AppConfig {
    const configPath = getConfigPath(projectRoot);

    if (!fileExists(configPath)) {
        throw new ConfigError(
            `No configuration found. Run "aiagentflow init" first.`,
            { configPath, projectRoot },
        );
    }

    logger.debug(`Loading config from ${configPath}`);

    const raw = applyEnvApiKeys(readJsonFile<unknown>(configPath), process.env);
    const result = appConfigSchema.safeParse(raw);

    if (!result.success) {
        const issues = result.error.issues.map(
            (i) => `  - ${i.path.join('.')}: ${i.message}`,
        ).join('\n');

        throw new ConfigError(
            `Invalid configuration file:\n${issues}`,
            { configPath, issues: result.error.issues },
        );
    }

    logger.debug('Config loaded and validated successfully');
    return result.data;
}

/**
 * Save configuration to disk, validating before write.
 *
 * @param projectRoot - The root directory of the project
 * @param config - The configuration to save
 * @throws {ConfigError} if validation fails or write fails
 */
export function saveConfig(projectRoot: string, config: AppConfig): void {
    const result = appConfigSchema.safeParse(config);

    if (!result.success) {
        const issues = result.error.issues.map(
            (i) => `  - ${i.path.join('.')}: ${i.message}`,
        ).join('\n');

        throw new ConfigError(
            `Cannot save invalid configuration:\n${issues}`,
            { issues: result.error.issues },
        );
    }

    const configDir = getConfigDir(projectRoot);
    const configPath = getConfigPath(projectRoot);

    ensureDir(configDir);
    writeJsonFile(configPath, result.data);
    logger.debug(`Config saved to ${configPath}`);
}

/**
 * Deep merge two config objects. Source values override target values.
 * Arrays are replaced, not concatenated.
 */
export function mergeConfig(
    target: Partial<AppConfig>,
    source: Partial<AppConfig>,
): Partial<AppConfig> {
    const result = { ...target };

    for (const key of Object.keys(source) as Array<keyof AppConfig>) {
        const sourceVal = source[key];
        const targetVal = result[key];

        if (
            sourceVal !== null &&
            sourceVal !== undefined &&
            typeof sourceVal === 'object' &&
            !Array.isArray(sourceVal) &&
            targetVal !== null &&
            targetVal !== undefined &&
            typeof targetVal === 'object' &&
            !Array.isArray(targetVal)
        ) {
            // Recursively merge objects
            (result as Record<string, unknown>)[key] = mergeConfig(
                targetVal as Partial<AppConfig>,
                sourceVal as Partial<AppConfig>,
            );
        } else if (sourceVal !== undefined) {
            (result as Record<string, unknown>)[key] = sourceVal;
        }
    }

    return result;
}

/**
 * Get the default configuration with optional partial overrides merged in.
 */
export function getDefaultConfig(overrides?: Partial<AppConfig>): AppConfig {
    if (!overrides) return { ...DEFAULT_CONFIG };
    return mergeConfig(DEFAULT_CONFIG, overrides) as AppConfig;
}
