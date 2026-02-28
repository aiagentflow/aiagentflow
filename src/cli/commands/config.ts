/**
 * `aiagentflow config` — View or edit configuration.
 *
 * Dependency direction: config.ts → commander, config module
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { configExists, loadConfig, getConfigPath } from '../../core/config/manager.js';
import { logger } from '../../utils/logger.js';

export const configCommand = new Command('config')
    .description('View or manage configuration')
    .option('-p, --path', 'Show config file path only')
    .action((options: { path?: boolean }) => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exit(1);
        }

        if (options.path) {
            console.log(getConfigPath(projectRoot));
            return;
        }

        const config = loadConfig(projectRoot);

        logger.header('Current Configuration');
        console.log(chalk.gray(`File: ${getConfigPath(projectRoot)}`));
        console.log();
        console.log(JSON.stringify(config, null, 2));
    });
