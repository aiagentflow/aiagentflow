/**
 * Project auto-detection via config file presence.
 *
 * Scans the project root for known config files to detect the
 * programming language, framework, and test framework in use.
 *
 * Dependency direction: project-detector.ts → node:fs, node:path
 * Used by: cli/commands/init.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ProjectInfo {
    /** Detected programming language. */
    language: string;
    /** Detected framework (or 'none'). */
    framework: string;
    /** Detected test framework. */
    testFramework: string;
}

// ── Language Detection ──

const LANGUAGE_SIGNALS: Array<{ files: string[]; language: string }> = [
    { files: ['tsconfig.json'], language: 'typescript' },
    { files: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'], language: 'python' },
    { files: ['go.mod'], language: 'go' },
    { files: ['Cargo.toml'], language: 'rust' },
    { files: ['pom.xml', 'build.gradle', 'build.gradle.kts'], language: 'java' },
    { files: ['Gemfile'], language: 'ruby' },
    { files: ['package.json'], language: 'javascript' },
];

function detectLanguage(projectRoot: string): string {
    for (const entry of LANGUAGE_SIGNALS) {
        for (const file of entry.files) {
            if (existsSync(join(projectRoot, file))) {
                return entry.language;
            }
        }
    }
    return 'typescript';
}

// ── Framework Detection ──

const FRAMEWORK_CONFIG_FILES: Array<{ patterns: string[]; framework: string }> = [
    { patterns: ['next.config.js', 'next.config.ts', 'next.config.mjs'], framework: 'next.js' },
    { patterns: ['nuxt.config.ts', 'nuxt.config.js'], framework: 'nuxt' },
    { patterns: ['angular.json'], framework: 'angular' },
    { patterns: ['svelte.config.js', 'svelte.config.ts'], framework: 'sveltekit' },
    { patterns: ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'], framework: 'astro' },
    { patterns: ['remix.config.js', 'remix.config.ts'], framework: 'remix' },
    { patterns: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'], framework: 'vite' },
    { patterns: ['manage.py'], framework: 'django' },
];

/** Read package.json dependencies (combined deps + devDeps). */
function readPackageDeps(projectRoot: string): Set<string> {
    const pkgPath = join(projectRoot, 'package.json');
    if (!existsSync(pkgPath)) return new Set();

    try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        return new Set([
            ...Object.keys(pkg.dependencies ?? {}),
            ...Object.keys(pkg.devDependencies ?? {}),
        ]);
    } catch {
        return new Set();
    }
}

/** Read a text file and check if it contains a keyword. */
function textFileContains(filePath: string, keyword: string): boolean {
    if (!existsSync(filePath)) return false;
    try {
        return readFileSync(filePath, 'utf-8').toLowerCase().includes(keyword.toLowerCase());
    } catch {
        return false;
    }
}

function detectFramework(projectRoot: string, language: string): string {
    // Check config files first
    for (const entry of FRAMEWORK_CONFIG_FILES) {
        for (const pattern of entry.patterns) {
            if (existsSync(join(projectRoot, pattern))) {
                return entry.framework;
            }
        }
    }

    // Check package.json deps for JS/TS projects
    if (language === 'typescript' || language === 'javascript') {
        const deps = readPackageDeps(projectRoot);
        if (deps.has('express')) return 'express';
        if (deps.has('fastify')) return 'fastify';
        if (deps.has('hono')) return 'hono';
        if (deps.has('koa')) return 'koa';
    }

    // Python framework detection
    if (language === 'python') {
        const reqPath = join(projectRoot, 'requirements.txt');
        if (textFileContains(reqPath, 'flask')) return 'flask';
        if (textFileContains(reqPath, 'fastapi')) return 'fastapi';
        const pyprojectPath = join(projectRoot, 'pyproject.toml');
        if (textFileContains(pyprojectPath, 'flask')) return 'flask';
        if (textFileContains(pyprojectPath, 'fastapi')) return 'fastapi';
    }

    return 'none';
}

// ── Test Framework Detection ──

const TEST_CONFIG_FILES: Array<{ patterns: string[]; testFramework: string }> = [
    { patterns: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts'], testFramework: 'vitest' },
    { patterns: ['jest.config.js', 'jest.config.ts', 'jest.config.mjs'], testFramework: 'jest' },
    { patterns: ['.mocharc.yml', '.mocharc.json', '.mocharc.js'], testFramework: 'mocha' },
    { patterns: ['cypress.config.ts', 'cypress.config.js'], testFramework: 'cypress' },
    { patterns: ['playwright.config.ts', 'playwright.config.js'], testFramework: 'playwright' },
];

/** Language-based fallback test frameworks. */
const LANGUAGE_TEST_DEFAULTS: Record<string, string> = {
    typescript: 'vitest',
    javascript: 'vitest',
    python: 'pytest',
    go: 'go test',
    rust: 'cargo test',
    java: 'junit',
    ruby: 'rspec',
};

function detectTestFramework(projectRoot: string, language: string): string {
    // Check test config files
    for (const entry of TEST_CONFIG_FILES) {
        for (const pattern of entry.patterns) {
            if (existsSync(join(projectRoot, pattern))) {
                return entry.testFramework;
            }
        }
    }

    // Check package.json devDeps for JS/TS projects
    if (language === 'typescript' || language === 'javascript') {
        const deps = readPackageDeps(projectRoot);
        if (deps.has('vitest')) return 'vitest';
        if (deps.has('jest')) return 'jest';
        if (deps.has('mocha')) return 'mocha';
    }

    // Check Python test tools
    if (language === 'python') {
        const reqPath = join(projectRoot, 'requirements.txt');
        if (textFileContains(reqPath, 'pytest')) return 'pytest';
        const pyprojectPath = join(projectRoot, 'pyproject.toml');
        if (textFileContains(pyprojectPath, 'pytest')) return 'pytest';
    }

    return LANGUAGE_TEST_DEFAULTS[language] ?? 'npm test';
}

// ── Public API ──

/**
 * Detect project language, framework, and test framework from config files.
 */
export function detectProject(projectRoot: string): ProjectInfo {
    const language = detectLanguage(projectRoot);
    const framework = detectFramework(projectRoot, language);
    const testFramework = detectTestFramework(projectRoot, language);

    return { language, framework, testFramework };
}
