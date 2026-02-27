/**
 * `ai-workflow init` — Interactive setup wizard.
 *
 * Walks the user through configuring providers, models, and workflow settings.
 * Generates `.ai-workflow/config.json` in the current project directory.
 *
 * Dependency direction: init.ts → commander, prompts, ora, chalk, config module
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import prompts from 'prompts';
import chalk from 'chalk';
import ora from 'ora';
import { configExists, saveConfig, getDefaultConfig, getConfigPath } from '../../core/config/manager.js';
import type { AppConfig } from '../../core/config/types.js';
import { ALL_AGENT_ROLES, AGENT_ROLE_LABELS } from '../../agents/types.js';
import type { LLMProviderName } from '../../providers/types.js';
import { getSupportedProviders } from '../../providers/registry.js';
import { generateDefaultPrompts } from '../../prompts/library.js';
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
            logger.success('Setup complete! Run "ai-workflow doctor" to verify your setup.');
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
        console.log(chalk.gray('  1. Run "ai-workflow doctor" to verify providers'));
        console.log(chalk.gray('  2. Run "ai-workflow run <task>" to start a workflow'));
        console.log();
    });

/**
 * Run the interactive setup wizard.
 */
async function runWizard(projectRoot: string): Promise<AppConfig | null> {
    const config = getDefaultConfig();
    const availableProviders = getSupportedProviders();

    // ── Step 1: Project Detection ──
    logger.step(1, 5, 'Project Settings');
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
    logger.step(2, 5, 'LLM Providers');
    const providerAnswers = await prompts({
        type: 'multiselect',
        name: 'providers',
        message: 'Select LLM providers to configure:',
        choices: availableProviders.map((p) => ({
            title: p === 'anthropic' ? 'Anthropic (Claude)' : 'Ollama (Local Models)',
            value: p,
            selected: true,
        })),
        min: 1,
    });

    if (!providerAnswers.providers) return null;
    const selectedProviders = providerAnswers.providers as LLMProviderName[];

    // ── Step 3: Provider Configuration ──
    logger.step(3, 5, 'Provider Settings');

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
    logger.step(4, 5, 'Agent Model Assignment');

    const defaultProvider = selectedProviders.includes('anthropic') ? 'anthropic' : 'ollama';
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
    logger.step(5, 5, 'Workflow Settings');
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

    return config;
}
