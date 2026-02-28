#!/usr/bin/env node

/**
 * CLI entry point — registers all commands with Commander.js.
 *
 * Dependency direction: cli/index.ts → commander, all command files
 * Used by: package.json bin entry ("ai-agent-flow" binary)
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { configCommand } from './commands/config.js';
import { doctorCommand } from './commands/doctor.js';
import { runCommand } from './commands/run.js';

const program = new Command();

program
    .name('ai-agent-flow')
    .description('AI Engineering Workflow Orchestrator — multi-agent development automation')
    .version('0.1.0');

// Register commands
program.addCommand(initCommand);
program.addCommand(configCommand);
program.addCommand(doctorCommand);
program.addCommand(runCommand);

program.parse();
