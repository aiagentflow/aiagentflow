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
import { CONFIG_DIR_NAME, WORKFLOW_PRESETS, type WorkflowMode } from '../../core/config/defaults.js';
import type { AppConfig } from '../../core/config/types.js';
import { ALL_AGENT_ROLES, AGENT_ROLE_LABELS, type AgentRole } from '../../agents/types.js';
import type { LLMProviderName } from '../../providers/types.js';
import { getSupportedProviders } from '../../providers/registry.js';
import { PROVIDER_LABELS, PROVIDER_DEFAULT_MODELS, PROVIDER_DESCRIPTIONS } from '../../providers/metadata.js';
import { pickModel } from '../utils/model-picker.js';
import { generateDefaultPrompts } from '../../prompts/library.js';
import { ensureDir } from '../../utils/fs.js';
import { detectPackageManager, buildTestCommand } from '../../utils/package-manager.js';
import { detectProject } from '../../utils/project-detector.js';
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
    const pm = detectPackageManager(projectRoot);
    const detected = detectProject(projectRoot);

    console.log(chalk.gray(`  Detected: ${detected.language} / ${detected.framework} / ${detected.testFramework} (${pm.name})`));
    console.log();

    const languageChoices = [
        { title: 'TypeScript', value: 'typescript' },
        { title: 'JavaScript', value: 'javascript' },
        { title: 'Python', value: 'python' },
        { title: 'Go', value: 'go' },
        { title: 'Rust', value: 'rust' },
        { title: 'Java', value: 'java' },
        { title: 'Ruby', value: 'ruby' },
        { title: 'Other', value: 'other' },
    ];
    const detectedLangIndex = languageChoices.findIndex(c => c.value === detected.language);

    const projectAnswers = await prompts([
        {
            type: 'select',
            name: 'language',
            message: 'Primary programming language:',
            choices: languageChoices,
            initial: detectedLangIndex >= 0 ? detectedLangIndex : 0,
        },
        {
            type: 'text',
            name: 'framework',
            message: 'Framework (or "none"):',
            initial: detected.framework,
        },
        {
            type: 'text',
            name: 'testFramework',
            message: 'Test framework:',
            initial: detected.testFramework,
        },
    ]);

    if (!projectAnswers.language) return null;

    config.project.language = projectAnswers.language;
    config.project.framework = projectAnswers.framework;
    config.project.testFramework = projectAnswers.testFramework;

    // Set language-appropriate globs
    const globs = getLanguageGlobs(projectAnswers.language);
    config.project.sourceGlobs = globs.sourceGlobs;
    config.project.testGlobs = globs.testGlobs;

    // ── Step 2: Provider Selection ──
    logger.step(2, 6, 'LLM Providers');
    const providerAnswers = await prompts({
        type: 'multiselect',
        name: 'providers',
        message: 'Select LLM providers to configure (space to toggle, enter to confirm):',
        choices: availableProviders.map((p) => ({
            title: PROVIDER_DESCRIPTIONS[p],
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

    if (selectedProviders.includes('openai')) {
        const openaiAnswers = await prompts([
            {
                type: 'password',
                name: 'apiKey',
                message: 'OpenAI API key:',
                validate: (val: string) => val.length >= 8 || 'API key seems too short',
            },
        ]);

        if (!openaiAnswers.apiKey) return null;

        config.providers.openai = {
            apiKey: openaiAnswers.apiKey,
            baseUrl: 'https://api.openai.com',
        };
    }

    if (selectedProviders.includes('gemini')) {
        const geminiAnswers = await prompts([
            {
                type: 'password',
                name: 'apiKey',
                message: 'Google Gemini API key:',
                validate: (val: string) => val.length >= 8 || 'API key seems too short',
            },
        ]);

        if (!geminiAnswers.apiKey) return null;

        config.providers.gemini = {
            apiKey: geminiAnswers.apiKey,
            baseUrl: 'https://generativelanguage.googleapis.com',
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

    const hasMixableProviders = selectedProviders.length > 1;

    const getDefaultModel = (p: LLMProviderName) => PROVIDER_DEFAULT_MODELS[p];
    const providerLabel = (p: LLMProviderName) => PROVIDER_LABELS[p];

    if (hasMixableProviders) {
        // Multiple providers — let user choose assignment strategy
        console.log(chalk.gray('  You have multiple providers. You can assign them per agent role.'));
        console.log(chalk.gray('  Tip: Use cloud APIs for reasoning (architect, reviewer, judge)'));
        console.log(chalk.gray('  and local models for generation (coder, tester, fixer).'));
        console.log();

        const { assignmentMode } = await prompts({
            type: 'select',
            name: 'assignmentMode',
            message: 'How do you want to assign providers to agents?',
            choices: [
                { title: 'All agents use the same provider', value: 'single' },
                { title: 'Smart split — cloud for reasoning, local for coding', value: 'smart' },
                { title: 'Customize each agent individually', value: 'custom' },
            ],
        });

        if (!assignmentMode) return null;

        if (assignmentMode === 'single') {
            const { preferredProvider } = await prompts({
                type: 'select',
                name: 'preferredProvider',
                message: 'Which provider for all agents?',
                choices: selectedProviders.map((p) => ({
                    title: providerLabel(p),
                    value: p,
                })),
            });

            if (!preferredProvider) return null;

            const model = await pickModel(
                preferredProvider,
                config.providers,
                'Model for all agents:',
            ) ?? getDefaultModel(preferredProvider);

            for (const role of ALL_AGENT_ROLES) {
                config.agents[role] = {
                    ...config.agents[role],
                    provider: preferredProvider,
                    model,
                };
            }
            console.log(chalk.gray(`  All agents → ${preferredProvider} / ${model}`));

        } else if (assignmentMode === 'smart') {
            // Reasoning roles → cloud (anthropic), generation roles → local (ollama)
            const cloudProvider = selectedProviders.includes('anthropic') ? 'anthropic'
                : selectedProviders.includes('openai') ? 'openai'
                : selectedProviders.includes('gemini') ? 'gemini'
                : selectedProviders[0]!;
            const localProvider = selectedProviders.includes('ollama') ? 'ollama' : selectedProviders[0]!;

            const reasoningRoles: AgentRole[] = ['architect', 'reviewer', 'judge'];
            const generationRoles: AgentRole[] = ['coder', 'tester', 'fixer'];

            for (const role of reasoningRoles) {
                config.agents[role] = {
                    ...config.agents[role],
                    provider: cloudProvider,
                    model: getDefaultModel(cloudProvider),
                };
            }
            for (const role of generationRoles) {
                config.agents[role] = {
                    ...config.agents[role],
                    provider: localProvider,
                    model: getDefaultModel(localProvider),
                };
            }

            console.log();
            console.log(chalk.bold('  Assignment:'));
            for (const role of ALL_AGENT_ROLES) {
                const p = config.agents[role].provider;
                console.log(chalk.gray(`    ${AGENT_ROLE_LABELS[role]} → ${p} / ${config.agents[role].model}`));
            }

        } else {
            // Custom: ask per role
            for (const role of ALL_AGENT_ROLES) {
                const label = AGENT_ROLE_LABELS[role];
                const { provider: roleProvider } = await prompts({
                    type: 'select',
                    name: 'provider',
                    message: `${label} — provider:`,
                    choices: selectedProviders.map((p) => ({ title: providerLabel(p), value: p })),
                });

                if (!roleProvider) return null;

                const chosenProvider = roleProvider as LLMProviderName;
                const model = await pickModel(
                    chosenProvider,
                    config.providers,
                    `${label} — model:`,
                ) ?? getDefaultModel(chosenProvider);

                config.agents[role] = {
                    ...config.agents[role],
                    provider: chosenProvider,
                    model,
                };
            }
        }
    } else {
        // Single provider — simpler flow
        const defaultProvider = selectedProviders[0]!;
        const defaultModel = getDefaultModel(defaultProvider);

        console.log(chalk.gray(`  Provider: ${providerLabel(defaultProvider)}`));

        const { customizeModel } = await prompts({
            type: 'confirm',
            name: 'customizeModel',
            message: 'Use the same model for all agents? (No = customize per role)',
            initial: true,
        });

        if (customizeModel) {
            const model = await pickModel(
                defaultProvider,
                config.providers,
                'Model to use for all agents:',
            );

            for (const role of ALL_AGENT_ROLES) {
                config.agents[role] = {
                    ...config.agents[role],
                    provider: defaultProvider,
                    model: model || defaultModel,
                };
            }
        } else {
            for (const role of ALL_AGENT_ROLES) {
                const label = AGENT_ROLE_LABELS[role];
                const model = await pickModel(
                    defaultProvider,
                    config.providers,
                    `${label} — model:`,
                );

                config.agents[role] = {
                    ...config.agents[role],
                    provider: defaultProvider,
                    model: model || defaultModel,
                };
            }
        }
    }

    // ── Step 5: Workflow Settings ──
    logger.step(5, 6, 'Workflow Settings');

    const { mode } = await prompts({
        type: 'select',
        name: 'mode',
        message: 'Workflow mode:',
        choices: [
            { title: 'Fast — fewer iterations, no approval, higher creativity', value: 'fast' },
            { title: 'Balanced — moderate iterations, approval on (recommended)', value: 'balanced' },
            { title: 'Strict — more iterations, lower temperatures, thorough QA', value: 'strict' },
        ],
        initial: 1,
    });

    const selectedMode = (mode ?? 'balanced') as WorkflowMode;
    const preset = WORKFLOW_PRESETS[selectedMode];
    config.workflow.mode = selectedMode;
    config.workflow.maxIterations = preset.maxIterations;
    config.workflow.humanApproval = preset.humanApproval;
    config.workflow.autoCommit = preset.autoCommit;

    // Apply temperature presets to agents
    for (const [role, temp] of Object.entries(preset.temperatures)) {
        if (config.agents[role as keyof typeof config.agents]) {
            config.agents[role as keyof typeof config.agents].temperature = temp;
        }
    }

    console.log(chalk.gray(`  Mode: ${selectedMode} — iterations: ${preset.maxIterations}, approval: ${preset.humanApproval ? 'on' : 'off'}, auto-commit: ${preset.autoCommit ? 'on' : 'off'}`));

    const { customize } = await prompts({
        type: 'confirm',
        name: 'customize',
        message: 'Customize individual settings?',
        initial: false,
    });

    if (customize) {
        const customAnswers = await prompts([
            {
                type: 'number',
                name: 'maxIterations',
                message: 'Max fix iterations per task:',
                initial: preset.maxIterations,
                min: 1,
                max: 20,
            },
            {
                type: 'confirm',
                name: 'humanApproval',
                message: 'Require human approval between stages?',
                initial: preset.humanApproval,
            },
            {
                type: 'confirm',
                name: 'autoCreateBranch',
                message: 'Auto-create Git branch for each task?',
                initial: true,
            },
            {
                type: 'confirm',
                name: 'autoCommit',
                message: 'Auto-commit changes when QA passes?',
                initial: preset.autoCommit,
            },
        ]);

        config.workflow.maxIterations = customAnswers.maxIterations ?? preset.maxIterations;
        config.workflow.humanApproval = customAnswers.humanApproval ?? preset.humanApproval;
        config.workflow.autoCreateBranch = customAnswers.autoCreateBranch ?? true;
        config.workflow.autoCommit = customAnswers.autoCommit ?? preset.autoCommit;

        if (config.workflow.autoCommit) {
            const { autoCommitMessage } = await prompts({
                type: 'text',
                name: 'autoCommitMessage',
                message: 'Commit message template ({task} = task description):',
                initial: 'ai: {task}',
            });
            config.workflow.autoCommitMessage = autoCommitMessage || 'ai: {task}';
        }
    }

    const defaultTestCmd = buildTestCommand(config.project.testFramework, projectRoot);
    const { testCommand } = await prompts({
        type: 'text',
        name: 'testCommand',
        message: 'Test command:',
        initial: defaultTestCmd,
    });
    if (testCommand && testCommand !== defaultTestCmd) {
        config.workflow.testCommand = testCommand;
    }

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

/** Get language-appropriate source and test glob patterns. */
function getLanguageGlobs(language: string): { sourceGlobs: string[]; testGlobs: string[] } {
    const globs: Record<string, { sourceGlobs: string[]; testGlobs: string[] }> = {
        typescript: { sourceGlobs: ['src/**/*.{ts,tsx}'], testGlobs: ['tests/**/*.test.ts'] },
        javascript: { sourceGlobs: ['src/**/*.{js,jsx}'], testGlobs: ['tests/**/*.test.js'] },
        python: { sourceGlobs: ['src/**/*.py'], testGlobs: ['tests/**/*.py'] },
        go: { sourceGlobs: ['**/*.go'], testGlobs: ['**/*_test.go'] },
        rust: { sourceGlobs: ['src/**/*.rs'], testGlobs: ['tests/**/*.rs'] },
        java: { sourceGlobs: ['src/**/*.java'], testGlobs: ['src/test/**/*.java'] },
        ruby: { sourceGlobs: ['lib/**/*.rb'], testGlobs: ['spec/**/*.rb'] },
    };
    return globs[language] ?? { sourceGlobs: ['src/**/*.ts'], testGlobs: ['tests/**/*.test.ts'] };
}
