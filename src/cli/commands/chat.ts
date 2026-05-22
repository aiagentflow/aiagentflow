/**
 * `aiagentflow chat` — Talk to a single agent directly without running the full pipeline.
 *
 * Useful for ad-hoc tasks: reviewing a file, generating a snippet, asking for a plan.
 *
 * Dependency direction: chat.ts → commander, agents/factory, context-loader, config
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { configExists, loadConfig } from '../../core/config/manager.js';
import { createAgent } from '../../agents/factory.js';
import { ALL_AGENT_ROLES, AGENT_ROLE_LABELS, type AgentRole } from '../../agents/types.js';
import { createStreamRenderer } from '../utils/stream-renderer.js';
import { logger } from '../../utils/logger.js';

export const chatCommand = new Command('chat')
    .description('Talk to a single agent directly')
    .argument('<agent>', `Agent role: ${ALL_AGENT_ROLES.join(', ')}`)
    .argument('[message]', 'Task or question (reads from stdin if omitted)')
    .option('--file <paths...>', 'Files to include as context')
    .option('--no-stream', 'Disable streaming output')
    .action(async (agentArg: string, messageArg: string | undefined, options: { file?: string[]; stream: boolean }) => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exit(1);
        }

        if (!ALL_AGENT_ROLES.includes(agentArg as AgentRole)) {
            logger.error(`Unknown agent: "${agentArg}". Valid agents: ${ALL_AGENT_ROLES.join(', ')}`);
            process.exit(1);
        }

        const role = agentArg as AgentRole;

        // Resolve the task from arg or stdin
        let task = messageArg ?? '';
        if (!task) {
            if (process.stdin.isTTY) {
                logger.error('Provide a message argument or pipe input via stdin.');
                process.exit(1);
            }
            task = readFileSync('/dev/stdin', 'utf-8').trim();
        }

        if (!task) {
            logger.error('No message provided.');
            process.exit(1);
        }

        // Load context files
        let context: string | undefined;
        if (options.file && options.file.length > 0) {
            const parts: string[] = [];
            for (const filePath of options.file) {
                if (!existsSync(filePath)) {
                    logger.warn(`File not found, skipping: ${filePath}`);
                    continue;
                }
                const content = readFileSync(filePath, 'utf-8');
                parts.push(`## ${filePath}\n\`\`\`\n${content}\n\`\`\``);
            }
            if (parts.length > 0) {
                context = parts.join('\n\n');
            }
        }

        const config = loadConfig(projectRoot);
        const agent = createAgent(role, config, projectRoot);
        const label = AGENT_ROLE_LABELS[role];

        console.log();
        logger.header(`Chat — ${label}`);
        console.log();

        try {
            if (options.stream) {
                const renderer = createStreamRenderer(role);
                await agent.executeStreaming({ task, context }, renderer.callbacks);
                renderer.finish();
            } else {
                const output = await agent.execute({ task, context });
                console.log(output.content);
            }
        } catch (err) {
            logger.error(`Chat failed: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });
