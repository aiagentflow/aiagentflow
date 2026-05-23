/**
 * `aiagentflow ui` — launch the terminal UI dashboard.
 *
 * Renders an Ink-based TUI showing active runs, their states, and costs.
 * Press q to exit.
 *
 * Dependency direction: ui.ts → commander, ink, ui/App
 * Used by: cli/index.ts
 */

import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from '../../ui/App.js';

export const uiCommand = new Command('ui')
    .description('Open the terminal UI dashboard')
    .action(() => {
        const projectRoot = process.cwd();
        const { waitUntilExit } = render(React.createElement(App, { projectRoot }));
        waitUntilExit().then(() => process.exit(0));
    });
