/**
 * Structured console logger with chalk colors and log levels.
 *
 * Dependency direction: logger.ts → chalk (external only)
 * Used by: every layer for consistent logging output
 */

import chalk from 'chalk';

export enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
    Silent = 4,
}

let currentLevel: LogLevel = LogLevel.Info;

/** Set the global log level. */
export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}

/** Get the current global log level. */
export function getLogLevel(): LogLevel {
    return currentLevel;
}

/** Log a debug message (grey, only shown at Debug level). */
export function debug(message: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.Debug) {
        console.debug(chalk.gray(`[DEBUG] ${message}`), ...args);
    }
}

/** Log an info message (blue). */
export function info(message: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.Info) {
        console.info(chalk.blue(`[INFO]  ${message}`), ...args);
    }
}

/** Log a success message (green). */
export function success(message: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.Info) {
        console.info(chalk.green(`✔ ${message}`), ...args);
    }
}

/** Log a warning message (yellow). */
export function warn(message: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.Warn) {
        console.warn(chalk.yellow(`[WARN]  ${message}`), ...args);
    }
}

/** Log an error message (red). */
export function error(message: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.Error) {
        console.error(chalk.red(`[ERROR] ${message}`), ...args);
    }
}

/** Log a step in a process (cyan, with step number). */
export function step(stepNumber: number, total: number, message: string): void {
    if (currentLevel <= LogLevel.Info) {
        console.info(chalk.cyan(`[${stepNumber}/${total}] ${message}`));
    }
}

/** Log a blank line for readability. */
export function blank(): void {
    if (currentLevel <= LogLevel.Info) {
        console.log();
    }
}

/** Log a header/banner (bold white). */
export function header(message: string): void {
    if (currentLevel <= LogLevel.Info) {
        console.log();
        console.log(chalk.bold.white(message));
        console.log(chalk.gray('─'.repeat(Math.min(message.length + 4, 60))));
    }
}

export const logger = {
    debug,
    info,
    success,
    warn,
    error,
    step,
    blank,
    header,
    setLogLevel,
    getLogLevel,
};
