/**
 * `aiagentflow doctor` — Health check for providers and setup.
 *
 * Verifies environment, config, prompt files, agent-provider mapping,
 * and provider connectivity.
 *
 * Dependency direction: doctor.ts → commander, ora, chalk, config module, registry
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import { configExists, loadConfig } from '../../core/config/manager.js';
import { getPromptsDir, getPoliciesDir } from '../../prompts/library.js';
import { validateAllProviders } from '../../providers/registry.js';
import { ALL_AGENT_ROLES } from '../../agents/types.js';
import type { AgentRole } from '../../agents/types.js';
import { logger } from '../../utils/logger.js';

/** Result of a single check. */
interface CheckResult {
    ok: boolean;
    label: string;
    detail?: string;
}

function pass(label: string): CheckResult {
    return { ok: true, label };
}

function fail(label: string, detail?: string): CheckResult {
    return { ok: false, label, detail };
}

function skip(label: string): CheckResult {
    return { ok: true, label: chalk.gray(`- ${label} (skipped)`) };
}

function printResult(result: CheckResult): void {
    if (result.label.startsWith(chalk.gray('-'))) {
        // Already formatted skip result
        console.log(`  ${result.label}`);
    } else if (result.ok) {
        console.log(chalk.green(`  ✔ ${result.label}`));
    } else {
        console.log(chalk.red(`  ✘ ${result.label}`));
        if (result.detail) {
            console.log(chalk.gray(`    → ${result.detail}`));
        }
    }
}

/** Check Node.js version meets minimum requirement. */
function checkNodeVersion(): CheckResult {
    const version = process.versions.node;
    const major = parseInt(version.split('.')[0]!, 10);
    if (major >= 20) {
        return pass(`Node.js v${version}`);
    }
    return fail(`Node.js v${version}`, 'Requires Node.js >= 20.0.0');
}

/** Check if git is available. */
function checkGit(): CheckResult {
    try {
        const version = execSync('git --version', { encoding: 'utf-8' }).trim();
        return pass(version);
    } catch {
        return fail('Git not found', 'Install git for auto-branch and auto-commit features');
    }
}

/** Check if prompt files exist for all agent roles. */
function checkPromptFiles(projectRoot: string): CheckResult[] {
    const promptsDir = getPromptsDir(projectRoot);
    const results: CheckResult[] = [];

    if (!existsSync(promptsDir)) {
        results.push(fail('Prompts directory missing', 'Run "aiagentflow init" to generate'));
        return results;
    }

    let allExist = true;
    const missing: string[] = [];
    for (const role of ALL_AGENT_ROLES) {
        const filePath = `${promptsDir}/${role}.md`;
        if (!existsSync(filePath)) {
            allExist = false;
            missing.push(role);
        }
    }

    if (allExist) {
        results.push(pass(`Agent prompts (${ALL_AGENT_ROLES.length}/${ALL_AGENT_ROLES.length})`));
    } else {
        results.push(fail(
            `Agent prompts (${ALL_AGENT_ROLES.length - missing.length}/${ALL_AGENT_ROLES.length})`,
            `Missing: ${missing.join(', ')} — run "aiagentflow init" to regenerate`,
        ));
    }

    const policiesDir = getPoliciesDir(projectRoot);
    const standardsPath = `${policiesDir}/coding-standards.md`;
    if (existsSync(standardsPath)) {
        results.push(pass('Coding standards policy'));
    } else {
        results.push(fail('Coding standards policy missing', 'Run "aiagentflow init" to generate'));
    }

    return results;
}

/** Verify each agent's provider is actually configured. */
function checkAgentProviderMapping(config: ReturnType<typeof loadConfig>): CheckResult[] {
    const results: CheckResult[] = [];
    const configuredProviders = new Set(
        Object.keys(config.providers).filter(
            (p) => !!config.providers[p as keyof typeof config.providers],
        ),
    );

    // Ollama is always "configured" (no API key needed)
    configuredProviders.add('ollama');

    for (const role of ALL_AGENT_ROLES) {
        const agentConfig = config.agents[role as AgentRole];
        const provider = agentConfig.provider;
        const model = agentConfig.model;

        if (configuredProviders.has(provider)) {
            results.push(pass(`${role} → ${provider}/${model}`));
        } else {
            results.push(fail(
                `${role} → ${provider}/${model}`,
                `Provider "${provider}" is not configured`,
            ));
        }
    }

    return results;
}

export const doctorCommand = new Command('doctor')
    .description('Check project setup and provider health')
    .action(async () => {
        const projectRoot = process.cwd();
        let failures = 0;

        // ── Environment ──
        logger.header('Environment');

        const nodeResult = checkNodeVersion();
        const gitResult = checkGit();
        printResult(nodeResult);
        printResult(gitResult);
        if (!nodeResult.ok) failures++;
        if (!gitResult.ok) failures++;

        // ── Configuration ──
        console.log();
        logger.header('Configuration');

        if (!configExists(projectRoot)) {
            printResult(fail('Configuration file', 'Run "aiagentflow init" first'));
            process.exit(1);
        }
        printResult(pass('Configuration file found'));

        let config;
        try {
            config = loadConfig(projectRoot);
            printResult(pass('Configuration is valid'));
        } catch (err) {
            printResult(fail('Configuration is invalid', err instanceof Error ? err.message : String(err)));
            process.exit(1);
        }

        // ── Prompt Files ──
        console.log();
        logger.header('Prompt Files');

        const promptResults = checkPromptFiles(projectRoot);
        for (const r of promptResults) {
            printResult(r);
            if (!r.ok) failures++;
        }

        // ── Agent → Provider Mapping ──
        console.log();
        logger.header('Agent Configuration');

        const mappingResults = checkAgentProviderMapping(config);
        for (const r of mappingResults) {
            printResult(r);
            if (!r.ok) failures++;
        }

        // ── Provider Connectivity ──
        console.log();
        logger.header('Provider Connectivity');

        const spinner = ora('Testing providers...').start();
        const results = await validateAllProviders(config.providers);
        spinner.stop();

        for (const [name, healthy] of Object.entries(results)) {
            const isConfigured = name === 'ollama' || !!config.providers[name as keyof typeof config.providers];

            if (healthy) {
                printResult(pass(`${name} — connected`));
            } else if (isConfigured) {
                printResult(fail(`${name} — connection failed`));
                failures++;
            } else {
                printResult(skip(`${name} — not configured`));
            }
        }

        // ── Summary ──
        console.log();
        if (failures === 0) {
            logger.success('All checks passed! You\'re ready to go.');
        } else {
            logger.warn(`${failures} check(s) failed. Review the output above.`);
        }
    });
