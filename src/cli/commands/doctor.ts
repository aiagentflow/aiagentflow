/**
 * `aiagentflow doctor` — Health check for providers and setup.
 *
 * Verifies that all configured providers can connect and that
 * the project is properly set up.
 *
 * Dependency direction: doctor.ts → commander, ora, chalk, config module, registry
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { configExists, loadConfig } from '../../core/config/manager.js';
import { validateAllProviders } from '../../providers/registry.js';
import { logger } from '../../utils/logger.js';

export const doctorCommand = new Command('doctor')
    .description('Check project setup and provider health')
    .action(async () => {
        const projectRoot = process.cwd();

        logger.header('AI Workflow — Health Check');

        // Check config exists
        const configCheck = configExists(projectRoot);
        console.log(
            configCheck
                ? chalk.green('  ✔ Configuration file found')
                : chalk.red('  ✘ No configuration file — run "aiagentflow init"'),
        );

        if (!configCheck) {
            process.exit(1);
        }

        // Load config
        const config = loadConfig(projectRoot);
        console.log(chalk.green('  ✔ Configuration is valid'));

        // Check providers
        console.log();
        logger.info('Checking provider connections...');

        const spinner = ora('Testing providers...').start();
        const results = await validateAllProviders(config.providers);
        spinner.stop();

        let allHealthy = true;
        for (const [name, healthy] of Object.entries(results)) {
            if (healthy) {
                console.log(chalk.green(`  ✔ ${name} — connected`));
            } else {
                const isConfigured =
                    name === 'anthropic' ? !!config.providers.anthropic
                    : name === 'openai' ? !!config.providers.openai
                    : !!config.providers.ollama;

                if (isConfigured) {
                    console.log(chalk.red(`  ✘ ${name} — connection failed`));
                    allHealthy = false;
                } else {
                    console.log(chalk.gray(`  - ${name} — not configured (skipped)`));
                }
            }
        }

        // Summary
        console.log();
        if (allHealthy) {
            logger.success('All checks passed! You\'re ready to go.');
        } else {
            logger.warn('Some checks failed. Review the output above.');
        }
    });
