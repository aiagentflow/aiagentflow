/**
 * Common validators for user input and data.
 *
 * Dependency direction: validation.ts → zod
 * Used by: CLI commands, config module
 */

import { z } from 'zod';

/** Validate that a string is a non-empty trimmed string. */
export const nonEmptyString = z.string().trim().min(1, 'Value cannot be empty');

/** Validate a URL string. */
export const urlString = z.string().url('Must be a valid URL');

/** Validate a port number (1-65535). */
export const portNumber = z.number().int().min(1).max(65535);

/**
 * Validate that an API key looks reasonable (non-empty, no whitespace).
 * Does NOT validate against the provider — just basic format.
 */
export const apiKeyFormat = z
    .string()
    .trim()
    .min(8, 'API key seems too short')
    .refine((val) => !/\s/.test(val), 'API key must not contain whitespace');

/**
 * Validate a model name string (alphanumeric, hyphens, colons, dots, slashes).
 * Examples: "claude-3-5-sonnet-20241022", "llama3.2:latest", "gpt-4o"
 */
export const modelName = z
    .string()
    .trim()
    .min(1, 'Model name cannot be empty')
    .regex(
        /^[a-zA-Z0-9][a-zA-Z0-9\-_.:\/]*$/,
        'Model name must start with alphanumeric and contain only alphanumeric, hyphens, underscores, dots, colons, or slashes',
    );

/**
 * Validate a positive integer within a reasonable range.
 */
export function positiveInt(max: number = 100): z.ZodNumber {
    return z.number().int().min(1).max(max);
}
