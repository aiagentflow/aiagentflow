/**
 * `aiagentflow init` — Interactive setup wizard.
 *
 * Walks the user through configuring providers, models, and workflow settings.
 * Generates `.aiagentflow/config.json` in the current project directory.
 *
 * Dependency direction: init.ts → commander, prompts, ora, chalk, config module
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import prompts from 'prompts';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync, copyFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { configExists, saveConfig, getDefaultConfig, getConfigPath } from '../../core/config/manager.js';
import { CONFIG_DIR_NAME } from '../../core/config/defaults.js';
import type { AppConfig } from '../../core/config/types.js';
import { ALL_AGENT_ROLES, AGENT_ROLE_LABELS } from '../../agents/types.js';
import type { LLMProviderName } from '../../providers/types.js';
import { getSupportedProviders } from '../../providers/registry.js';
import { generateDefaultPrompts } from '../../prompts/library.js';
import { ensureDir } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';

export const initCommand = new Command('init')
    .description('Initialize AI Workflow in the current project')
    .option('-f, --force', 'Overwrite existing configuration')
    .option('-y, --yes', 'Accept defaults without prompting')
    .action(async (options: { force?: boolean; yes?: boolean }) => {
        const projectRoot = process.cwd();

        logger.header('AI Workflow — Project Setup');

        // Check for existing config
        if (configExists(projectRoot) && !options.force) {
            const { overwrite } = await prompts({
                type: 'confirm',
                name: 'overwrite',
                message: 'Configuration already exists. Overwrite?',
                initial: false,
            });

            if (!overwrite) {
                logger.info('Setup cancelled.');
                return;
            }
        }

        // Quick mode — accept all defaults
        if (options.yes) {
            const config = getDefaultConfig();
            const spinner = ora('Saving configuration...').start();
            saveConfig(projectRoot, config);
            generateDefaultPrompts(projectRoot);
            spinner.succeed(`Configuration saved to ${getConfigPath(projectRoot)}`);
            logger.success('Setup complete! Run "aiagentflow doctor" to verify your setup.');
            return;
        }

        // Interactive wizard
        const config = await runWizard(projectRoot);

        if (!config) {
            logger.info('Setup cancelled.');
            return;
        }

        const spinner = ora('Saving configuration...').start();
        saveConfig(projectRoot, config);
        generateDefaultPrompts(projectRoot);
        spinner.succeed(`Configuration saved to ${getConfigPath(projectRoot)}`);

        console.log();
        logger.success('Setup complete!');
        console.log(chalk.gray('  Next steps:'));
        console.log(chalk.gray('  1. Run "aiagentflow doctor" to verify providers'));
        console.log(chalk.gray('  2. Drop docs in .aiagentflow/context/ for auto-loaded context'));
        console.log(chalk.gray('  3. Run "aiagentflow run <task>" to start a workflow'));
        console.log(chalk.gray('  4. Run "aiagentflow plan <doc>" to generate a task list from specs'));
        console.log();
    });

/**
 * Run the interactive setup wizard.
 */
async function runWizard(projectRoot: string): Promise<AppConfig | null> {
    const config = getDefaultConfig();
    const availableProviders = getSupportedProviders();

    // ── Step 1: Project Detection ──
    logger.step(1, 6, 'Project Settings');
    const projectAnswers = await prompts([
        {
            type: 'select',
            name: 'language',
            message: 'Primary programming language:',
            choices: [
                { title: 'TypeScript', value: 'typescript' },
                { title: 'JavaScript', value: 'javascript' },
                { title: 'Python', value: 'python' },
                { title: 'Go', value: 'go' },
                { title: 'Rust', value: 'rust' },
                { title: 'Java', value: 'java' },
                { title: 'Other', value: 'other' },
            ],
            initial: 0,
        },
        {
            type: 'text',
            name: 'framework',
            message: 'Framework (or "none"):',
            initial: 'none',
        },
        {
            type: 'text',
            name: 'testFramework',
            message: 'Test framework:',
            initial: 'vitest',
        },
    ]);

    if (!projectAnswers.language) return null;

    config.project.language = projectAnswers.language;
    config.project.framework = projectAnswers.framework;
    config.project.testFramework = projectAnswers.testFramework;

    // ── Step 2: Provider Selection ──
    logger.step(2, 6, 'LLM Providers');
    const providerAnswers = await prompts({
        type: 'multiselect',
        name: 'providers',
        message: 'Select LLM providers to configure (space to toggle, enter to confirm):',
        choices: availableProviders.map((p) => ({
            title: p === 'anthropic' ? 'Anthropic (Claude) — requires API key' : 'Ollama (Local Models) — free, no API key needed',
            value: p,
            selected: p === 'ollama',
        })),
        min: 1,
    });

    if (!providerAnswers.providers) return null;
    const selectedProviders = providerAnswers.providers as LLMProviderName[];

    // ── Step 3: Provider Configuration ──
    logger.step(3, 6, 'Provider Settings');

    if (selectedProviders.includes('anthropic')) {
        const anthropicAnswers = await prompts([
            {
                type: 'password',
                name: 'apiKey',
                message: 'Anthropic API key:',
                validate: (val: string) => val.length >= 8 || 'API key seems too short',
            },
        ]);

        if (!anthropicAnswers.apiKey) return null;

        config.providers.anthropic = {
            apiKey: anthropicAnswers.apiKey,
            baseUrl: 'https://api.anthropic.com',
            apiVersion: '2023-06-01',
        };
    }

    if (selectedProviders.includes('ollama')) {
        const ollamaAnswers = await prompts({
            type: 'text',
            name: 'baseUrl',
            message: 'Ollama base URL:',
            initial: 'http://localhost:11434',
        });

        config.providers.ollama = {
            baseUrl: ollamaAnswers.baseUrl || 'http://localhost:11434',
        };
    }

    // ── Step 4: Agent Model Assignment ──
    logger.step(4, 6, 'Agent Model Assignment');

    let defaultProvider: LLMProviderName;

    if (selectedProviders.length === 1) {
        defaultProvider = selectedProviders[0]!;
    } else {
        const { preferredProvider } = await prompts({
            type: 'select',
            name: 'preferredProvider',
            message: 'Which provider should be the default for all agents?',
            choices: selectedProviders.map((p) => ({
                title: p === 'anthropic' ? 'Anthropic (Claude)' : 'Ollama (Local Models)',
                value: p,
            })),
        });

        if (!preferredProvider) return null;
        defaultProvider = preferredProvider;
    }

    const defaultModel = defaultProvider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'llama3.2:latest';

    console.log(chalk.gray(`  Default: ${defaultProvider} / ${defaultModel}`));

    const { customizeAgents } = await prompts({
        type: 'confirm',
        name: 'customizeAgents',
        message: 'Customize model per agent role? (No = use defaults for all)',
        initial: false,
    });

    if (customizeAgents) {
        for (const role of ALL_AGENT_ROLES) {
            const label = AGENT_ROLE_LABELS[role];
            const roleAnswers = await prompts([
                {
                    type: 'select',
                    name: 'provider',
                    message: `${label} — provider:`,
                    choices: selectedProviders.map((p) => ({ title: p, value: p })),
                    initial: selectedProviders.indexOf(defaultProvider),
                },
                {
                    type: 'text',
                    name: 'model',
                    message: `${label} — model:`,
                    initial: (prev: string) =>
                        prev === 'anthropic' ? 'claude-sonnet-4-20250514' : 'llama3.2:latest',
                },
            ]);

            if (!roleAnswers.provider) return null;

            config.agents[role] = {
                ...config.agents[role],
                provider: roleAnswers.provider,
                model: roleAnswers.model,
            };
        }
    } else {
        // Apply defaults to all agents
        for (const role of ALL_AGENT_ROLES) {
            config.agents[role] = {
                ...config.agents[role],
                provider: defaultProvider,
                model: defaultModel,
            };
        }
    }

    // ── Step 5: Workflow Settings ──
    logger.step(5, 6, 'Workflow Settings');
    const workflowAnswers = await prompts([
        {
            type: 'number',
            name: 'maxIterations',
            message: 'Max fix iterations per task:',
            initial: 5,
            min: 1,
            max: 20,
        },
        {
            type: 'confirm',
            name: 'humanApproval',
            message: 'Require human approval between stages?',
            initial: true,
        },
        {
            type: 'confirm',
            name: 'autoCreateBranch',
            message: 'Auto-create Git branch for each task?',
            initial: true,
        },
    ]);

    config.workflow.maxIterations = workflowAnswers.maxIterations ?? 5;
    config.workflow.humanApproval = workflowAnswers.humanApproval ?? true;
    config.workflow.autoCreateBranch = workflowAnswers.autoCreateBranch ?? true;

    // ── Step 6: Context Documents ──
    logger.step(6, 6, 'Context Documents');
    console.log(chalk.gray('  Agents perform better with reference docs (specs, PRDs, guidelines).'));
    console.log(chalk.gray('  Files added here are auto-loaded into every workflow run.'));
    console.log();

    const { hasContextDocs } = await prompts({
        type: 'confirm',
        name: 'hasContextDocs',
        message: 'Do you have existing specs, requirements, or guidelines to include?',
        initial: false,
    });

    if (hasContextDocs) {
        const { docPaths } = await prompts({
            type: 'list',
            name: 'docPaths',
            message: 'Paths to doc files (comma-separated):',
            separator: ',',
        });

        if (docPaths && docPaths.length > 0) {
            const contextDir = join(projectRoot, CONFIG_DIR_NAME, 'context');
            ensureDir(contextDir);

            let copied = 0;
            for (const rawPath of docPaths) {
                const trimmed = rawPath.trim();
                if (!trimmed) continue;

                const resolved = resolve(projectRoot, trimmed);
                if (!existsSync(resolved)) {
                    logger.warn(`File not found, skipping: ${trimmed}`);
                    continue;
                }

                const dest = join(contextDir, basename(resolved));
                copyFileSync(resolved, dest);
                logger.debug(`Copied ${trimmed} → .aiagentflow/context/${basename(resolved)}`);
                copied++;
            }

            if (copied > 0) {
                logger.success(`Copied ${copied} document(s) to .aiagentflow/context/`);
            }
        }
    }

    return config;
}
