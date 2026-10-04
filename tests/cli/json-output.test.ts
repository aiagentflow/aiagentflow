import { describe, it, expect, afterEach } from 'vitest';
import { enableJsonOutput } from '../../src/cli/utils/json-output.js';

describe('enableJsonOutput', () => {
    const originalStdout = process.stdout.write;
    const originalStderr = process.stderr.write;

    afterEach(() => {
        process.stdout.write = originalStdout;
        process.stderr.write = originalStderr;
    });

    it('sends events to stdout as NDJSON and everything else to stderr', () => {
        const stdout: string[] = [];
        const stderr: string[] = [];
        process.stdout.write = ((chunk: string) => { stdout.push(String(chunk)); return true; }) as typeof process.stdout.write;
        process.stderr.write = ((chunk: string) => { stderr.push(String(chunk)); return true; }) as typeof process.stderr.write;

        const events = enableJsonOutput();
        // console.* writes through process.stdout.write in Node (vitest wraps console, so call write directly)
        process.stdout.write('human readable log\n');
        process.stdout.write('spinner frame');
        events.emit({ type: 'step.started', step: 'plan', agent: 'architect' });

        expect(stdout).toHaveLength(1);
        expect(JSON.parse(stdout[0]!)).toMatchObject({ type: 'step.started', step: 'plan' });
        expect(stderr.join('')).toContain('human readable log');
        expect(stderr.join('')).toContain('spinner frame');
    });
});
