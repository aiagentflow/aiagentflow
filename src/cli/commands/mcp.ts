/**
 * `aiagentflow mcp` — inspect and test MCP server configuration.
 *
 * Subcommands:
 *   list  — show all configured MCP servers and their tools
 *   test  — start a server, call tools/list, and exit
 *
 * Dependency direction: mcp.ts → commander, mcp/registry, config
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { McpRegistry } from '../../mcp/registry.js';
import { McpClient } from '../../mcp/client.js';
import { loadConfig, configExists } from '../../core/config/manager.js';
import { logger } from '../../utils/logger.js';

const mcpList = new Command('list')
    .description('List all configured MCP servers and their tools')
    .action(async () => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exit(1);
        }

        const config = loadConfig(projectRoot);
        const servers = config.mcpServers ?? {};
        const names = Object.keys(servers);

        if (names.length === 0) {
            console.log(chalk.gray('No MCP servers configured.'));
            console.log(chalk.gray('Add servers to .aiagentflow/config.json under "mcpServers".'));
            return;
        }

        console.log(chalk.bold(`\n  ${names.length} MCP server(s) configured\n`));

        for (const [name, serverConfig] of Object.entries(servers)) {
            console.log(chalk.cyan(`  ${name}`));
            console.log(chalk.gray(`    Command: ${serverConfig.command} ${(serverConfig.args ?? []).join(' ')}`));
            if (serverConfig.allowedRoles) {
                console.log(chalk.gray(`    Roles: ${serverConfig.allowedRoles.join(', ')}`));
            } else {
                console.log(chalk.gray('    Roles: all'));
            }
        }

        console.log();
        console.log(chalk.gray('  Run "aiagentflow mcp test <server>" to verify a server starts correctly.'));
        console.log();
    });

const mcpTest = new Command('test')
    .description('Start an MCP server and list its tools')
    .argument('<server>', 'Server name (as defined in config)')
    .action(async (serverName: string) => {
        const projectRoot = process.cwd();

        if (!configExists(projectRoot)) {
            logger.error('No configuration found. Run "aiagentflow init" first.');
            process.exit(1);
        }

        const config = loadConfig(projectRoot);
        const serverConfig = config.mcpServers?.[serverName];

        if (!serverConfig) {
            logger.error(`No MCP server named "${serverName}" in config.`);
            const names = Object.keys(config.mcpServers ?? {});
            if (names.length > 0) {
                logger.info(`Available servers: ${names.join(', ')}`);
            }
            process.exit(1);
        }

        console.log(chalk.bold(`\n  Testing MCP server: ${serverName}\n`));
        console.log(chalk.gray(`  Command: ${serverConfig.command} ${(serverConfig.args ?? []).join(' ')}`));
        console.log();

        const client = new McpClient(serverName, serverConfig);

        try {
            process.stdout.write('  Starting server... ');
            await client.start();
            console.log(chalk.green('✓'));

            process.stdout.write('  Listing tools... ');
            const tools = await client.listTools();
            console.log(chalk.green(`✓ (${tools.length} tool(s))`));

            if (tools.length > 0) {
                console.log();
                for (const tool of tools) {
                    console.log(chalk.cyan(`    ${tool.name}`));
                    if (tool.description) {
                        console.log(chalk.gray(`      ${tool.description}`));
                    }
                    const props = Object.keys(tool.inputSchema.properties ?? {});
                    if (props.length > 0) {
                        console.log(chalk.gray(`      Params: ${props.join(', ')}`));
                    }
                }
            }

            console.log();
            logger.success(`Server "${serverName}" is healthy.`);
        } catch (err) {
            console.log(chalk.red('✗'));
            logger.error(`Server "${serverName}" failed: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        } finally {
            client.stop();
        }
    });

export const mcpCommand = new Command('mcp')
    .description('Manage and debug MCP server configuration')
    .addCommand(mcpList)
    .addCommand(mcpTest);
