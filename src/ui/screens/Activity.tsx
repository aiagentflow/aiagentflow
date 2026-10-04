/**
 * TUI Activity screen — live feed of the most recent run's events.
 *
 * Tails the run's event log (.aiagentflow/sessions/<id>.events.ndjson),
 * written by the runner's EventBus, so it works for runs in any process.
 *
 * Dependency direction: Activity.tsx → ink, core/events, core/workflow/session
 * Used by: ui/App.tsx
 */

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { describeEvent, readEventLog, type TimedRunEvent } from '../../core/events.js';
import { getEventLogPath, listSessions, type SessionData } from '../../core/workflow/session.js';
import { runLabel } from '../../core/workflow/engine.js';

/** Events shown in the feed. */
const FEED_SIZE = 12;

interface Props {
    projectRoot: string;
}

type ColorName = 'green' | 'red' | 'yellow' | 'cyan' | 'gray' | 'white';

function eventColor(event: TimedRunEvent): ColorName {
    switch (event.type) {
        case 'step.finished':
            return event.outcome === 'passed' ? 'green' : event.outcome === 'failed' ? 'yellow' : 'red';
        case 'run.finished':
            return event.status === 'passed' ? 'green' : 'red';
        case 'check.finished':
            return event.passed ? 'green' : 'yellow';
        case 'verdict':
            return event.verdict.verdict === 'approve' || event.verdict.verdict === 'pass' ? 'green' : 'yellow';
        case 'tool.result':
            return event.isError ? 'red' : 'gray';
        case 'step.started':
        case 'run.started':
            return 'cyan';
        default:
            return 'white';
    }
}

export function Activity({ projectRoot }: Props): React.JSX.Element {
    const [session, setSession] = useState<SessionData | undefined>();
    const [events, setEvents] = useState<TimedRunEvent[]>([]);

    useEffect(() => {
        const refresh = () => {
            const latest = listSessions(projectRoot)[0];
            setSession(latest);
            // tool.called is implied by tool.result; skip it to keep the feed short
            setEvents(latest
                ? readEventLog(getEventLogPath(projectRoot, latest.id), FEED_SIZE * 2).filter(e => e.type !== 'tool.called').slice(-FEED_SIZE)
                : []);
        };
        refresh();
        const interval = setInterval(refresh, 1000);
        return () => clearInterval(interval);
    }, [projectRoot]);

    if (!session) {
        return <Text color="gray">No runs yet.</Text>;
    }

    return (
        <Box flexDirection="column">
            <Box paddingLeft={2} marginBottom={1}>
                <Text bold>Latest run </Text>
                <Text color="gray">{session.id} — {runLabel(session.context)}</Text>
            </Box>
            {events.length === 0 && (
                <Box paddingLeft={2}>
                    <Text color="gray">No events recorded for this run.</Text>
                </Box>
            )}
            {events.map((event, i) => (
                <Box key={`${event.time}-${i}`} paddingLeft={2}>
                    <Text color="gray">{event.time.slice(11, 19)}  </Text>
                    <Text color={eventColor(event)}>{describeEvent(event)}</Text>
                </Box>
            ))}
        </Box>
    );
}
