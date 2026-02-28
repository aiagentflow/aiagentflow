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

/**
 * Load and validate the configuration from disk.
 *
 * @param projectRoot - The root directory of the project (where .ai-agent-flow/ lives)
 * @returns The validated AppConfig
 * @throws {ConfigError} if the file doesn't exist, is invalid JSON, or fails validation
 */
export function loadConfig(projectRoot: string): AppConfig {
    const configPath = getConfigPath(projectRoot);

    if (!fileExists(configPath)) {
        throw new ConfigError(
            `No configuration found. Run "ai-agent-flow init" first.`,
            { configPath, projectRoot },
        );
    }

    logger.debug(`Loading config from ${configPath}`);

    const raw = readJsonFile<unknown>(configPath);
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
