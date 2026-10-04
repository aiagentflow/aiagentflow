// Example aiagentflow plugin (API v2).
//
// - Step `no-todos`: fails when files changed in the run contain TODO/FIXME
//   comments, so the workflow routes to its onFail step (usually the fixer).
// - Tool `list_todos`: lets agents find TODO/FIXME comments themselves.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const manifest = {
    name: 'no-todos',
    version: '1.0.0',
    apiVersion: 2,
    description: 'Fail the workflow when changed files contain TODO or FIXME comments.',
};

const DEFAULT_PATTERN = '\\b(TODO|FIXME)\\b';

/** "file:line: text" for every match in the given files. */
function findTodos(root, files, pattern) {
    const regex = new RegExp(pattern);
    const hits = [];
    for (const file of files) {
        const path = join(root, file);
        if (!existsSync(path)) continue;
        readFileSync(path, 'utf-8').split('\n').forEach((line, i) => {
            if (regex.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    return hits;
}

export const steps = [
    {
        name: 'no-todos',
        description: 'Fail if changed files contain TODO/FIXME comments',
        async run(ctx) {
            const pattern = typeof ctx.with.pattern === 'string' ? ctx.with.pattern : DEFAULT_PATTERN;
            const hits = findTodos(ctx.projectRoot, ctx.changedFiles, pattern);
            return hits.length === 0
                ? { passed: true, summary: `No TODOs in ${ctx.changedFiles.length} changed file(s)` }
                : { passed: false, summary: `Remove these TODO/FIXME comments:\n${hits.join('\n')}` };
        },
    },
];

export const tools = [
    {
        definition: {
            name: 'list_todos',
            description: 'List TODO and FIXME comments in the given files.',
            inputSchema: {
                type: 'object',
                properties: { files: { type: 'array', items: { type: 'string' }, description: 'Paths relative to the project root' } },
                required: ['files'],
            },
        },
        // Only the agents that change code need it
        roles: ['coder', 'fixer'],
        async execute(input) {
            const files = Array.isArray(input.files) ? input.files.map(String) : [];
            const hits = findTodos(process.cwd(), files, DEFAULT_PATTERN);
            return hits.length > 0 ? hits.join('\n') : 'No TODO or FIXME comments.';
        },
    },
];
