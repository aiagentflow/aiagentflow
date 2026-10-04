/**
 * Repo map: a compact, token-budgeted overview of the project.
 *
 * Lists project files grouped by directory, with the top-level/exported
 * symbols of each source file. Agents get this instead of full file
 * contents and pull details on demand with read_file and grep.
 *
 * Symbols are found with per-language regexes: cheap and dependency-free,
 * good enough for orientation (not a parser).
 *
 * Dependency direction: repo-map.ts → tools/repo (listFiles), node:fs
 * Used by: workflow runner
 */

import { readFileSync, statSync } from 'node:fs';
import { extname, join, posix } from 'node:path';
import { listFiles } from '../../tools/repo.js';

/** Default token budget for the map (~4 characters per token). */
export const DEFAULT_REPO_MAP_TOKENS = 4000;
/** Source files larger than this are listed without symbols. */
const MAX_SCAN_BYTES = 200_000;
/** Most symbols listed per file. */
const MAX_SYMBOLS_PER_FILE = 12;

type SymbolPattern = { re: RegExp; kind?: number; name: number };

const JS_TS: SymbolPattern[] = [
    { re: /^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(function\*?|class|interface|type|enum|const|let|var|namespace)\s+([A-Za-z_$][\w$]*)/gm, kind: 1, name: 2 },
];

const SYMBOL_PATTERNS: Record<string, SymbolPattern[]> = {
    '.ts': JS_TS, '.tsx': JS_TS, '.mts': JS_TS, '.cts': JS_TS,
    '.js': JS_TS, '.jsx': JS_TS, '.mjs': JS_TS, '.cjs': JS_TS,
    '.py': [{ re: /^(def|class|async def)\s+([A-Za-z]\w*)/gm, kind: 1, name: 2 }],
    '.go': [
        { re: /^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm, name: 1 },
        { re: /^type\s+([A-Z]\w*)\s+(struct|interface)?/gm, name: 1 },
    ],
    '.rs': [{ re: /^pub(?:\([^)]*\))?\s+(?:async\s+)?(fn|struct|enum|trait|type|mod|const)\s+(\w+)/gm, kind: 1, name: 2 }],
    '.java': [{ re: /^\s*public\s+(?:static\s+|final\s+|abstract\s+|sealed\s+)*(class|interface|enum|record)\s+(\w+)/gm, kind: 1, name: 2 }],
    '.kt': [{ re: /^\s*(?:public\s+|data\s+|sealed\s+|abstract\s+|open\s+)*(class|interface|object|fun)\s+(\w+)/gm, kind: 1, name: 2 }],
    '.cs': [{ re: /^\s*public\s+(?:static\s+|sealed\s+|abstract\s+|partial\s+)*(class|interface|enum|record|struct)\s+(\w+)/gm, kind: 1, name: 2 }],
    '.rb': [{ re: /^\s*(class|module|def)\s+([\w:.]+)/gm, kind: 1, name: 2 }],
    '.php': [{ re: /^\s*(?:final\s+|abstract\s+)?(class|interface|trait|enum|function)\s+(\w+)/gm, kind: 1, name: 2 }],
};

/** Short labels so the map stays compact. */
const KIND_LABELS: Record<string, string> = {
    'function': 'fn', 'function*': 'fn', 'async def': 'fn', 'def': 'fn', 'fun': 'fn',
    'interface': 'iface', 'namespace': 'ns', 'module': 'mod',
    'let': 'var', 'var': 'var', 'const': 'const',
};

export interface RepoMapOptions {
    /** Token budget for the whole map. */
    maxTokens?: number;
}

/** Extract the exported / top-level symbols of one source file. */
export function extractSymbols(path: string, content: string): string[] {
    const patterns = SYMBOL_PATTERNS[extname(path).toLowerCase()];
    if (!patterns) return [];

    const found: Array<{ index: number; label: string }> = [];
    for (const { re, kind, name } of patterns) {
        re.lastIndex = 0;
        for (const m of content.matchAll(re)) {
            const symbol = m[name];
            if (!symbol || symbol.startsWith('_')) continue;
            const rawKind = kind ? m[kind] : undefined;
            const label = rawKind ? `${KIND_LABELS[rawKind] ?? rawKind} ${symbol}` : symbol;
            found.push({ index: m.index ?? 0, label });
        }
    }
    // Source order, deduplicated (Go functions and types come from separate patterns)
    return [...new Set(found.sort((a, b) => a.index - b.index).map(f => f.label))];
}

/**
 * Build the repo map for `root`.
 *
 * If the full map exceeds the budget, symbols are dropped from the largest
 * entries first; if file names alone still exceed it, the list is cut off.
 */
export async function buildRepoMap(root: string, options: RepoMapOptions = {}): Promise<string> {
    const maxChars = (options.maxTokens ?? DEFAULT_REPO_MAP_TOKENS) * 4;
    const files = await listFiles(root);
    if (files.length === 0) return '';

    const entries = files.map(file => ({ file, symbols: readSymbols(root, file) }));

    // Shrink symbol lists until the map fits, biggest first
    let rendered = render(entries);
    while (rendered.length > maxChars) {
        const biggest = entries.reduce((a, b) => (b.symbols.length > a.symbols.length ? b : a));
        if (biggest.symbols.length === 0) break;
        biggest.symbols = biggest.symbols.slice(0, Math.floor(biggest.symbols.length / 2));
        rendered = render(entries);
    }

    if (rendered.length > maxChars) {
        const cut = rendered.lastIndexOf('\n', maxChars);
        const shown = rendered.slice(0, cut);
        const shownFiles = shown.split('\n').filter(l => l.startsWith('  ')).length;
        rendered = `${shown}\n… ${files.length - shownFiles} more file(s); use list_dir to explore`;
    }

    return [
        '## Repository Map',
        '',
        'Project files (git-ignored files omitted), grouped by directory, with exported symbols.',
        'This is an overview only: use read_file, grep, and list_dir to see code before relying on it.',
        '',
        rendered,
    ].join('\n');
}

function readSymbols(root: string, file: string): string[] {
    if (!SYMBOL_PATTERNS[extname(file).toLowerCase()]) return [];
    try {
        const abs = join(root, file);
        if (statSync(abs).size > MAX_SCAN_BYTES) return [];
        return extractSymbols(file, readFileSync(abs, 'utf-8')).slice(0, MAX_SYMBOLS_PER_FILE);
    } catch {
        return [];
    }
}

function render(entries: ReadonlyArray<{ file: string; symbols: string[] }>): string {
    // Group by directory: root files first, then directories in path order
    const byDir = new Map<string, string[]>();
    for (const { file, symbols } of entries) {
        const dir = posix.dirname(file);
        const name = posix.basename(file);
        const line = symbols.length > 0 ? `  ${name}: ${symbols.join(', ')}` : `  ${name}`;
        byDir.set(dir, [...(byDir.get(dir) ?? []), line]);
    }

    const dirs = [...byDir.keys()].sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b)));
    return dirs.flatMap(dir => [dir === '.' ? './' : `${dir}/`, ...byDir.get(dir)!]).join('\n');
}
