/**
 * `aiagentflow acp`: run as an Agent Client Protocol server on stdio, for
 * editors such as Zed. The editor starts this command; it is not meant to be
 * run by hand.
 *
 * Dependency direction: acp.ts → commander, acp/server
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import { AcpServer } from '../../acp/server.js';
import { setLogLevel, LogLevel } from '../../utils/logger.js';

export const acpCommand = new Command('acp')
    .description('Run as an Agent Client Protocol (ACP) server on stdio, for editors such as Zed')
    .option('-w, --workflow <name>', 'Workflow for every prompt (default: standard)')
    .action(async (options: { workflow?: string }) => {
        // stdout carries protocol messages only: everything else goes to stderr
        const writeStdout = process.stdout.write.bind(process.stdout);
        process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
        setLogLevel(LogLevel.Warn);

        const server = new AcpServer(line => { writeStdout(line); }, { workflow: options.workflow });
        await server.listen(process.stdin);
    });
