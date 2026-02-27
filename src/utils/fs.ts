/**
 * File system helpers with consistent error handling.
 *
 * Dependency direction: fs.ts → node:fs, node:path, errors.ts
 * Used by: config manager, CLI commands
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ConfigError } from '../core/errors.js';

/**
 * Read a JSON file and parse it.
 * @throws {ConfigError} if the file doesn't exist or contains invalid JSON.
 */
export function readJsonFile<T>(filePath: string): T {
    const absolutePath = resolve(filePath);

    if (!existsSync(absolutePath)) {
        throw new ConfigError(`File not found: ${absolutePath}`, { filePath: absolutePath });
    }

    try {
        const content = readFileSync(absolutePath, 'utf-8');
        return JSON.parse(content) as T;
    } catch (err) {
        if (err instanceof ConfigError) throw err;
        throw new ConfigError(`Failed to parse JSON file: ${absolutePath}`, {
            filePath: absolutePath,
            originalError: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * Write data to a JSON file, creating parent directories if needed.
 * @throws {ConfigError} if the write fails.
 */
export function writeJsonFile(filePath: string, data: unknown): void {
    const absolutePath = resolve(filePath);

    try {
        const dir = dirname(absolutePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(absolutePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    } catch (err) {
        if (err instanceof ConfigError) throw err;
        throw new ConfigError(`Failed to write file: ${absolutePath}`, {
            filePath: absolutePath,
            originalError: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export function ensureDir(dirPath: string): void {
    const absolutePath = resolve(dirPath);
    if (!existsSync(absolutePath)) {
        mkdirSync(absolutePath, { recursive: true });
    }
}

/**
 * Check if a file exists at the given path.
 */
export function fileExists(filePath: string): boolean {
    return existsSync(resolve(filePath));
}

/**
 * Read a text file and return its contents.
 * @throws {ConfigError} if the file doesn't exist.
 */
export function readTextFile(filePath: string): string {
    const absolutePath = resolve(filePath);

    if (!existsSync(absolutePath)) {
        throw new ConfigError(`File not found: ${absolutePath}`, { filePath: absolutePath });
    }

    return readFileSync(absolutePath, 'utf-8');
}
