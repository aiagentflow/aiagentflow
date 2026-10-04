/**
 * Built-in repository tools: read_file, list_dir, grep, edit_file, write_file.
 *
 * Every path is resolved inside a single root (the project or its worktree)
 * and rejected if it escapes it, including via symlinks. Files changed
 * through edit_file / write_file are recorded in a ChangeSet so the workflow
 * knows what an agent touched.
 *
 * Dependency direction: tools/repo.ts → tools/registry.ts (types), execa, node:fs
 * Used by: agents/factory.ts
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execa } from 'execa';
import type { Tool, ToolOutput } from './registry.js';

/** Default and maximum lines returned by one read_file call. */
const DEFAULT_READ_LINES = 2000;
/** Lines longer than this are truncated in read_file / grep output. */
const MAX_LINE_CHARS = 2000;
/** Files larger than this are skipped by grep and refused by read_file. */
const MAX_FILE_BYTES = 1_000_000;
/** Default cap on grep matches. */
const DEFAULT_GREP_RESULTS = 100;
/** Default cap on list_dir entries. */
const MAX_LIST_ENTRIES = 500;
/** Directories never walked when git is unavailable. */
const ALWAYS_SKIPPED_DIRS = new Set(['.git', 'node_modules']);

/** Files created or modified by repo tools during a run (paths relative to root). */
export class ChangeSet {
    private readonly paths = new Set<string>();

    add(path: string): void {
        this.paths.add(path);
    }

    get files(): string[] {
        return [...this.paths];
    }

    get size(): number {
        return this.paths.size;
    }
}

export interface RepoToolsOptions {
    /** Directory all paths are resolved against (project root or worktree). */
    root: string;
    /** Records files written through edit_file / write_file. */
    changes?: ChangeSet;
    /** When true, only read_file, list_dir, and grep are provided. */
    readOnly?: boolean;
}

/** Names of the built-in repo tools that modify files. */
export const WRITE_TOOL_NAMES = ['edit_file', 'write_file'] as const;

/**
 * Create the repo tools bound to one root directory.
 */
export function createRepoTools(options: RepoToolsOptions): Tool[] {
    const root = realpathSync(resolve(options.root));
    const changes = options.changes;

    const readTools: Tool[] = [
        {
            definition: {
                name: 'read_file',
                description:
                    'Read a text file from the project. Returns numbered lines. ' +
                    `Use offset/limit for large files (default ${DEFAULT_READ_LINES} lines).`,
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'File path relative to the project root' },
                        offset: { type: 'integer', description: '1-based line to start from (default 1)' },
                        limit: { type: 'integer', description: `Number of lines to read (default ${DEFAULT_READ_LINES})` },
                    },
                    required: ['path'],
                },
            },
            async execute(input) {
                const rel = requireString(input, 'path');
                const abs = resolveInside(root, rel);
                if (!existsSync(abs) || !statSync(abs).isFile()) return error(`File not found: ${rel}`);
                if (statSync(abs).size > MAX_FILE_BYTES) return error(`File is too large to read (${rel})`);

                const lines = readFileSync(abs, 'utf-8').split('\n');
                const offset = Math.max(1, optionalInt(input, 'offset') ?? 1);
                const limit = Math.max(1, optionalInt(input, 'limit') ?? DEFAULT_READ_LINES);
                const slice = lines.slice(offset - 1, offset - 1 + limit);
                if (slice.length === 0) return `(${rel} has ${lines.length} lines; offset ${offset} is past the end)`;

                const body = slice.map((line, i) => `${String(offset + i).padStart(6)}\t${clip(line)}`).join('\n');
                const remaining = lines.length - (offset - 1 + slice.length);
                return remaining > 0 ? `${body}\n… ${remaining} more line(s); use offset ${offset + slice.length}` : body;
            },
        },
        {
            definition: {
                name: 'list_dir',
                description: 'List files and directories under a path (directories end with "/"). Ignores git-ignored files.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Directory relative to the project root (default ".")' },
                        recursive: { type: 'boolean', description: 'List all files below the directory (default false)' },
                    },
                },
            },
            async execute(input) {
                const rel = optionalString(input, 'path') ?? '.';
                const abs = resolveInside(root, rel);
                if (!existsSync(abs) || !statSync(abs).isDirectory()) return error(`Directory not found: ${rel}`);

                const prefix = toPosix(relative(root, abs));
                const files = (await listFiles(root)).filter(f => !prefix || f.startsWith(`${prefix}/`));
                const entries = input.recursive === true
                    ? files.map(f => (prefix ? f.slice(prefix.length + 1) : f))
                    : immediateChildren(files, prefix);

                if (entries.length === 0) return `(empty: ${rel})`;
                const shown = entries.slice(0, MAX_LIST_ENTRIES).join('\n');
                return entries.length > MAX_LIST_ENTRIES ? `${shown}\n… ${entries.length - MAX_LIST_ENTRIES} more` : shown;
            },
        },
        {
            definition: {
                name: 'grep',
                description: 'Search file contents with a regular expression. Returns "path:line: text" matches.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        pattern: { type: 'string', description: 'JavaScript regular expression' },
                        path: { type: 'string', description: 'Limit to this file or directory (relative to the project root)' },
                        glob: { type: 'string', description: 'Limit to files matching this glob, e.g. "**/*.ts"' },
                        ignore_case: { type: 'boolean', description: 'Case-insensitive match (default false)' },
                        max_results: { type: 'integer', description: `Maximum matches (default ${DEFAULT_GREP_RESULTS})` },
                    },
                    required: ['pattern'],
                },
            },
            async execute(input) {
                const source = requireString(input, 'pattern');
                let regex: RegExp;
                try {
                    regex = new RegExp(source, input.ignore_case === true ? 'i' : '');
                } catch (err) {
                    return error(`Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`);
                }

                const scope = optionalString(input, 'path');
                const scopePrefix = scope ? toPosix(relative(root, resolveInside(root, scope))) : '';
                const globRegex = optionalString(input, 'glob') ? globToRegExp(optionalString(input, 'glob')!) : undefined;
                const max = Math.max(1, optionalInt(input, 'max_results') ?? DEFAULT_GREP_RESULTS);

                const matches: string[] = [];
                for (const file of await listFiles(root)) {
                    if (scopePrefix && file !== scopePrefix && !file.startsWith(`${scopePrefix}/`)) continue;
                    if (globRegex && !globRegex.test(file)) continue;

                    const text = readTextIfSmall(join(root, file));
                    if (text === undefined) continue;

                    const lines = text.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (!regex.test(lines[i]!)) continue;
                        matches.push(`${file}:${i + 1}: ${clip(lines[i]!.trim())}`);
                        if (matches.length >= max) return `${matches.join('\n')}\n… stopped at ${max} matches`;
                    }
                }
                return matches.length > 0 ? matches.join('\n') : 'No matches.';
            },
        },
    ];

    if (options.readOnly) return readTools;

    const writeTools: Tool[] = [
        {
            definition: {
                name: 'edit_file',
                description:
                    'Replace an exact string in an existing file. old_string must match exactly once ' +
                    '(include surrounding lines to make it unique) unless replace_all is true. Read the file first.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'File path relative to the project root' },
                        old_string: { type: 'string', description: 'Exact text to replace' },
                        new_string: { type: 'string', description: 'Replacement text' },
                        replace_all: { type: 'boolean', description: 'Replace every occurrence (default false)' },
                    },
                    required: ['path', 'old_string', 'new_string'],
                },
            },
            async execute(input) {
                const rel = requireString(input, 'path');
                const oldString = requireString(input, 'old_string', { allowEmpty: false });
                const newString = requireString(input, 'new_string');
                const abs = resolveInside(root, rel);
                if (!existsSync(abs) || !statSync(abs).isFile()) {
                    return error(`File not found: ${rel}. Use write_file to create new files.`);
                }

                const text = readFileSync(abs, 'utf-8');
                const count = text.split(oldString).length - 1;
                if (count === 0) return error(`old_string not found in ${rel}. Re-read the file and copy the text exactly.`);
                if (count > 1 && input.replace_all !== true) {
                    return error(`old_string matches ${count} times in ${rel}. Add surrounding context to make it unique, or set replace_all.`);
                }

                writeFileSync(abs, text.split(oldString).join(newString));
                changes?.add(toPosix(relative(root, abs)));
                return `Edited ${rel} (${count} replacement${count === 1 ? '' : 's'}).`;
            },
        },
        {
            definition: {
                name: 'write_file',
                description: 'Create a new file with the given content. Fails if the file exists; use edit_file to change existing files.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'File path relative to the project root' },
                        content: { type: 'string', description: 'Full file content' },
                    },
                    required: ['path', 'content'],
                },
            },
            async execute(input) {
                const rel = requireString(input, 'path');
                const content = requireString(input, 'content');
                const abs = resolveInside(root, rel);
                if (existsSync(abs)) return error(`${rel} already exists. Use edit_file to modify it.`);

                mkdirSync(dirname(abs), { recursive: true });
                writeFileSync(abs, content);
                changes?.add(toPosix(relative(root, abs)));
                return `Created ${rel} (${content.split('\n').length} lines).`;
            },
        },
    ];

    return [...readTools, ...writeTools];
}

// ── Path safety ──

/**
 * Resolve `path` against `root` and make sure the result stays inside it.
 * Symlinks are resolved for the deepest existing ancestor, so a link that
 * points outside the root is rejected too.
 *
 * @throws {Error} if the path escapes the root
 */
export function resolveInside(root: string, path: string): string {
    const abs = resolve(root, path);
    if (!isWithin(root, abs)) throw new Error(`Path is outside the project: ${path}`);

    let existing = abs;
    while (!existsSync(existing)) existing = dirname(existing);
    if (!isWithin(realpathSync(root), realpathSync(existing))) throw new Error(`Path is outside the project: ${path}`);

    return abs;
}

function isWithin(root: string, abs: string): boolean {
    const rel = relative(root, abs);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// ── File listing ──

/**
 * All files under root as POSIX relative paths, honouring .gitignore when
 * root is in a git repository (tracked + untracked, minus ignored).
 */
async function listFiles(root: string): Promise<string[]> {
    try {
        const { stdout } = await execa('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root });
        return stdout.split('\0').filter(f => f && existsSync(join(root, f))).sort();
    } catch {
        return walk(root, '').sort();
    }
}

function walk(root: string, rel: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
        if (ALWAYS_SKIPPED_DIRS.has(entry.name)) continue;
        const child = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...walk(root, child));
        else if (entry.isFile()) out.push(child);
    }
    return out;
}

/** Direct children of `prefix` derived from a flat file list; directories end with "/". */
function immediateChildren(files: string[], prefix: string): string[] {
    const children = new Set<string>();
    for (const file of files) {
        const rest = prefix ? file.slice(prefix.length + 1) : file;
        const slash = rest.indexOf('/');
        children.add(slash === -1 ? rest : `${rest.slice(0, slash)}/`);
    }
    return [...children].sort((a, b) => Number(b.endsWith('/')) - Number(a.endsWith('/')) || a.localeCompare(b));
}

function readTextIfSmall(abs: string): string | undefined {
    try {
        if (statSync(abs).size > MAX_FILE_BYTES) return undefined;
        const text = readFileSync(abs, 'utf-8');
        return text.includes('\0') ? undefined : text; // skip binary files
    } catch {
        return undefined;
    }
}

/**
 * Convert a glob to a RegExp over POSIX paths.
 * Supports `**`, `*`, `?`, and `{a,b}`. A pattern without "/" matches the basename anywhere.
 */
export function globToRegExp(glob: string): RegExp {
    const pattern = glob.includes('/') ? glob : `**/${glob}`;
    let re = '';
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i]!;
        if (c === '*' && pattern[i + 1] === '*') {
            // "**/" matches zero or more directories
            if (pattern[i + 2] === '/') {
                re += '(?:.*/)?';
                i += 2;
            } else {
                re += '.*';
                i += 1;
            }
        } else if (c === '*') {
            re += '[^/]*';
        } else if (c === '?') {
            re += '[^/]';
        } else if (c === '{') {
            const end = pattern.indexOf('}', i);
            if (end === -1) {
                re += '\\{';
            } else {
                re += `(?:${pattern.slice(i + 1, end).split(',').map(escapeRegExp).join('|')})`;
                i = end;
            }
        } else {
            re += escapeRegExp(c);
        }
    }
    return new RegExp(`^${re}$`);
}

// ── Small helpers ──

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function toPosix(p: string): string {
    return sep === '/' ? p : p.split(sep).join('/');
}

function clip(line: string): string {
    return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
}

function error(content: string): ToolOutput {
    return { content, isError: true };
}

function requireString(input: Record<string, unknown>, key: string, opts: { allowEmpty?: boolean } = {}): string {
    const value = input[key];
    if (typeof value !== 'string' || (opts.allowEmpty === false && value === '')) {
        throw new Error(`"${key}" must be a${opts.allowEmpty === false ? ' non-empty' : ''} string`);
    }
    return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
    const value = input[key];
    return typeof value === 'string' && value !== '' ? value : undefined;
}

function optionalInt(input: Record<string, unknown>, key: string): number | undefined {
    const value = input[key];
    return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : undefined;
}
