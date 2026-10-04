/**
 * `aiagentflow migrate`: upgrade a v1 project to the v2 config format.
 *
 * Dependency direction: migrate.ts → commander, core/config/migrate
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { relative } from 'node:path';
import { migrateProject } from '../../core/config/migrate.js';
import { ExitCode, exitCodeForError } from '../utils/exit-codes.js';
import { logger } from '../../utils/logger.js';

export const migrateCommand = new Command('migrate')
    .description('Upgrade a v1 project (config and prompts) to v2, backing up the originals')
    .option('--dry-run', 'Show what would change without writing anything')
    .action((options: { dryRun?: boolean }) => {
        const projectRoot = process.cwd();
        try {
            const report = migrateProject(projectRoot, { dryRun: options.dryRun });

            if (!report.needed && report.promptsToReview.length === 0) {
                logger.success('Already up to date: nothing to migrate.');
                return;
            }

            const verb = options.dryRun ? 'Would change' : 'Changed';
            if (report.configChanges.length > 0) {
                console.log(chalk.bold(`\n${verb} .aiagentflow/config.json:`));
                for (const change of report.configChanges) console.log(chalk.gray(`  - ${change}`));
            }
            if (report.promptsUpgraded.length > 0) {
                console.log(chalk.bold(`\n${verb} prompts (untouched v1 defaults → v2 defaults):`));
                console.log(chalk.gray(`  ${report.promptsUpgraded.join(', ')}`));
            }
            if (report.promptsToReview.length > 0) {
                console.log(chalk.bold.yellow('\nCustomised prompts to update by hand:'));
                for (const { role, reason } of report.promptsToReview) {
                    console.log(chalk.yellow(`  - .aiagentflow/prompts/${role}.md ${reason}`));
                }
                console.log(chalk.gray('  Compare with the v2 default: delete the file to use it, or merge your changes into it.'));
            }

            console.log();
            if (options.dryRun) {
                logger.info('Dry run: nothing was written. Run without --dry-run to migrate.');
            } else if (report.backupDir) {
                logger.success(`Migrated. Originals backed up to ${relative(projectRoot, report.backupDir)}/`);
            }
        } catch (err) {
            logger.error(err instanceof Error ? err.message : String(err));
            process.exitCode = err instanceof Error ? exitCodeForError(err) : ExitCode.Failed;
        }
    });
