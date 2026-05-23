/**
 * TUI PlanApproval screen — interactive plan review for --review-plan runs.
 *
 * Displays the Architect's plan with scrolling and keyboard actions:
 *   a — approve,  e — edit in $EDITOR,  r — regenerate,  q — abort
 *
 * Dependency direction: PlanApproval.tsx → ink
 * Used by: ui/App.tsx
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface Props {
    plan: string;
    onApprove: () => void;
    onEdit: () => void;
    onRegenerate: (feedback: string) => void;
    onAbort: () => void;
}

export function PlanApproval({ plan, onApprove, onEdit, onRegenerate, onAbort }: Props): React.JSX.Element {
    const [inputMode, setInputMode] = useState<'view' | 'feedback'>('view');
    const [feedback, setFeedback] = useState('');
    const [scrollOffset, setScrollOffset] = useState(0);

    const lines = plan.split('\n');
    const visibleLines = 20;
    const visibleSlice = lines.slice(scrollOffset, scrollOffset + visibleLines);

    useInput((input, key) => {
        if (inputMode === 'feedback') {
            if (key.return) {
                if (feedback.trim()) {
                    onRegenerate(feedback.trim());
                }
                setInputMode('view');
                setFeedback('');
            } else if (key.backspace || key.delete) {
                setFeedback(f => f.slice(0, -1));
            } else if (!key.ctrl && !key.meta && input) {
                setFeedback(f => f + input);
            }
            return;
        }

        if (input === 'a') onApprove();
        if (input === 'e') onEdit();
        if (input === 'q') onAbort();
        if (input === 'r') setInputMode('feedback');
        if (key.downArrow || input === 'j') {
            setScrollOffset(o => Math.min(o + 1, Math.max(0, lines.length - visibleLines)));
        }
        if (key.upArrow || input === 'k') {
            setScrollOffset(o => Math.max(0, o - 1));
        }
    });

    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                <Text bold color="cyan">── Architect's Plan ──</Text>
                <Text color="gray">  ({lines.length} lines, showing {scrollOffset + 1}–{Math.min(scrollOffset + visibleLines, lines.length)})</Text>
            </Box>

            <Box flexDirection="column" marginBottom={1}>
                {visibleSlice.map((line, i) => (
                    <Text key={`${scrollOffset}-${i}`} color="white">{line}</Text>
                ))}
            </Box>

            {inputMode === 'feedback' ? (
                <Box flexDirection="column">
                    <Text color="yellow">Enter feedback for regeneration (Enter to submit):</Text>
                    <Text color="white">{'> '}{feedback}<Text color="gray">_</Text></Text>
                </Box>
            ) : (
                <Box>
                    <Text color="gray">  </Text>
                    <Text color="green">[a]</Text>
                    <Text color="gray">pprove  </Text>
                    <Text color="yellow">[e]</Text>
                    <Text color="gray">dit  </Text>
                    <Text color="blue">[r]</Text>
                    <Text color="gray">egenerate  </Text>
                    <Text color="red">[q]</Text>
                    <Text color="gray">uit  </Text>
                    <Text color="gray">↑↓ scroll</Text>
                </Box>
            )}
        </Box>
    );
}
