/**
 * TUI root application — tab-based layout for the aiagentflow dashboard.
 *
 * Screens:
 *   1. Runs    — live list of active worktree runs (auto-refreshes)
 *   2. Approve — plan approval (shown when a run is awaiting approval)
 *
 * Dependency direction: App.tsx → ink, ui/screens/*
 * Used by: cli/commands/ui.ts
 */

import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { RunsList } from './screens/RunsList.js';

type Screen = 'runs';

interface Props {
    projectRoot: string;
}

export function App({ projectRoot }: Props): React.JSX.Element {
    const { exit } = useApp();
    const [screen] = useState<Screen>('runs');

    useInput((input, key) => {
        if (input === 'q' || (key.ctrl && input === 'c')) {
            exit();
        }
    });

    return (
        <Box flexDirection="column" width="100%">
            {/* Header bar */}
            <Box paddingX={2} paddingY={0} marginBottom={1}>
                <Text bold color="cyan">aiagentflow</Text>
                <Text color="gray">  dashboard  </Text>
                <Text color={screen === 'runs' ? 'white' : 'gray'}>Runs</Text>
                <Text color="gray">    q to quit</Text>
            </Box>

            <Box paddingLeft={1}>
                {screen === 'runs' && <RunsList projectRoot={projectRoot} />}
            </Box>
        </Box>
    );
}
