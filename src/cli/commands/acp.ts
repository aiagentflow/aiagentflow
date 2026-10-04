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
import { claimStdout } from '../../utils/jsonrpc.js';

export const acpCommand = new Command('acp')
    .description('Run as an Agent Client Protocol (ACP) server on stdio, for editors such as Zed')
    .option('-w, --workflow <name>', 'Workflow for every prompt (default: standard)')
    .action(async (options: { workflow?: string }) => {
        // stdout carries protocol messages only: everything else goes to stderr
        const send = claimStdout();
        setLogLevel(LogLevel.Warn);

        const server = new AcpServer(send, { workflow: options.workflow });
        await server.listen(process.stdin);
    });
