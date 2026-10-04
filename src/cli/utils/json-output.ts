/**
 * Machine-readable output mode.
 *
 * In `--output json` mode stdout carries only NDJSON events. Everything a
 * human would read (logs, spinners, streaming previews, prompts) is moved to
 * stderr by redirecting process.stdout.write.
 *
 * Dependency direction: json-output.ts → core/events
 * Used by: cli/commands/run.ts, cli/commands/resume.ts
 */

import { EventBus, ndjsonListener } from '../../core/events.js';

/** Output formats accepted by --output. */
export const OUTPUT_FORMATS = ['text', 'json'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/**
 * Route human output to stderr and return an EventBus whose events are
 * written to the real stdout as NDJSON.
 */
export function enableJsonOutput(): EventBus {
    const writeStdout = process.stdout.write.bind(process.stdout);
    const toStderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = toStderr as typeof process.stdout.write;

    const events = new EventBus();
    events.subscribe(ndjsonListener(line => {
        writeStdout(line);
    }));
    return events;
}
