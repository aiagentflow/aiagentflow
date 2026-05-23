#!/usr/bin/env node

/**
 * CLI entry point — registers all commands with Commander.js.
 *
 * Dependency direction: cli/index.ts → commander, all command files
 * Used by: package.json bin entry ("aiagentflow" binary)
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { configCommand } from './commands/config.js';
import { doctorCommand } from './commands/doctor.js';
import { runCommand } from './commands/run.js';
import { planCommand } from './commands/plan.js';
import { resumeCommand } from './commands/resume.js';
import { sessionsCommand } from './commands/sessions.js';
import { chatCommand } from './commands/chat.js';
import { exportCommand } from './commands/export.js';
import { runsCommand } from './commands/runs.js';
import { discardCommand } from './commands/discard.js';
import { gcCommand } from './commands/gc.js';

const program = new Command();

program
    .name('aiagentflow')
    .description('AI Engineering Workflow Orchestrator — multi-agent development automation')
    .version('1.1.0');

// Register commands
program.addCommand(initCommand);
program.addCommand(configCommand);
program.addCommand(doctorCommand);
program.addCommand(runCommand);
program.addCommand(planCommand);
program.addCommand(resumeCommand);
program.addCommand(sessionsCommand);
program.addCommand(chatCommand);
program.addCommand(exportCommand);
program.addCommand(runsCommand);
program.addCommand(discardCommand);
program.addCommand(gcCommand);

program.parse();
