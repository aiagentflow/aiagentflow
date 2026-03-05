import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectProject } from '../../src/utils/project-detector.js';

let testDir: string;

beforeEach(() => {
    testDir = join(tmpdir(), `aiagentflow-detect-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
});

describe('language detection', () => {
    it('detects typescript from tsconfig.json', () => {
        writeFileSync(join(testDir, 'tsconfig.json'), '{}');
        expect(detectProject(testDir).language).toBe('typescript');
    });

    it('detects javascript from package.json (no tsconfig)', () => {
        writeFileSync(join(testDir, 'package.json'), '{}');
        expect(detectProject(testDir).language).toBe('javascript');
    });

    it('detects python from requirements.txt', () => {
        writeFileSync(join(testDir, 'requirements.txt'), 'flask\n');
        expect(detectProject(testDir).language).toBe('python');
    });

    it('detects python from pyproject.toml', () => {
        writeFileSync(join(testDir, 'pyproject.toml'), '[project]\nname = "myapp"\n');
        expect(detectProject(testDir).language).toBe('python');
    });

    it('detects go from go.mod', () => {
        writeFileSync(join(testDir, 'go.mod'), 'module example.com/app\n');
        expect(detectProject(testDir).language).toBe('go');
    });

    it('detects rust from Cargo.toml', () => {
        writeFileSync(join(testDir, 'Cargo.toml'), '[package]\nname = "app"\n');
        expect(detectProject(testDir).language).toBe('rust');
    });

    it('detects java from pom.xml', () => {
        writeFileSync(join(testDir, 'pom.xml'), '<project></project>');
        expect(detectProject(testDir).language).toBe('java');
    });

    it('detects java from build.gradle', () => {
        writeFileSync(join(testDir, 'build.gradle'), 'plugins {}');
        expect(detectProject(testDir).language).toBe('java');
    });

    it('detects ruby from Gemfile', () => {
        writeFileSync(join(testDir, 'Gemfile'), 'source "https://rubygems.org"\n');
        expect(detectProject(testDir).language).toBe('ruby');
    });

    it('prefers typescript over javascript when both exist', () => {
        writeFileSync(join(testDir, 'tsconfig.json'), '{}');
        writeFileSync(join(testDir, 'package.json'), '{}');
        expect(detectProject(testDir).language).toBe('typescript');
    });

    it('defaults to typescript when no files found', () => {
        expect(detectProject(testDir).language).toBe('typescript');
    });
});

describe('framework detection', () => {
    it('detects next.js from next.config.js', () => {
        writeFileSync(join(testDir, 'tsconfig.json'), '{}');
        writeFileSync(join(testDir, 'next.config.js'), 'module.exports = {}');
        expect(detectProject(testDir).framework).toBe('next.js');
    });

    it('detects next.js from next.config.mjs', () => {
        writeFileSync(join(testDir, 'next.config.mjs'), 'export default {}');
        expect(detectProject(testDir).framework).toBe('next.js');
    });

    it('detects nuxt from nuxt.config.ts', () => {
        writeFileSync(join(testDir, 'nuxt.config.ts'), 'export default {}');
        expect(detectProject(testDir).framework).toBe('nuxt');
    });

    it('detects angular from angular.json', () => {
        writeFileSync(join(testDir, 'angular.json'), '{}');
        expect(detectProject(testDir).framework).toBe('angular');
    });

    it('detects sveltekit from svelte.config.js', () => {
        writeFileSync(join(testDir, 'svelte.config.js'), 'export default {}');
        expect(detectProject(testDir).framework).toBe('sveltekit');
    });

    it('detects astro from astro.config.mjs', () => {
        writeFileSync(join(testDir, 'astro.config.mjs'), 'export default {}');
        expect(detectProject(testDir).framework).toBe('astro');
    });

    it('detects vite from vite.config.ts', () => {
        writeFileSync(join(testDir, 'vite.config.ts'), 'export default {}');
        expect(detectProject(testDir).framework).toBe('vite');
    });

    it('detects express from package.json deps', () => {
        writeFileSync(join(testDir, 'tsconfig.json'), '{}');
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
            dependencies: { express: '^4.18.0' },
        }));
        expect(detectProject(testDir).framework).toBe('express');
    });

    it('detects django from manage.py', () => {
        writeFileSync(join(testDir, 'requirements.txt'), 'django\n');
        writeFileSync(join(testDir, 'manage.py'), '#!/usr/bin/env python\n');
        expect(detectProject(testDir).framework).toBe('django');
    });

    it('detects flask from requirements.txt', () => {
        writeFileSync(join(testDir, 'requirements.txt'), 'flask\nrequests\n');
        expect(detectProject(testDir).framework).toBe('flask');
    });

    it('detects fastapi from requirements.txt', () => {
        writeFileSync(join(testDir, 'requirements.txt'), 'fastapi\nuvicorn\n');
        expect(detectProject(testDir).framework).toBe('fastapi');
    });

    it('returns none when no framework detected', () => {
        writeFileSync(join(testDir, 'tsconfig.json'), '{}');
        expect(detectProject(testDir).framework).toBe('none');
    });

    it('prefers config file over package.json deps', () => {
        writeFileSync(join(testDir, 'next.config.js'), 'module.exports = {}');
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
            dependencies: { express: '^4.18.0' },
        }));
        expect(detectProject(testDir).framework).toBe('next.js');
    });
});

describe('test framework detection', () => {
    it('detects vitest from config file', () => {
        writeFileSync(join(testDir, 'vitest.config.ts'), 'export default {}');
        expect(detectProject(testDir).testFramework).toBe('vitest');
    });

    it('detects jest from config file', () => {
        writeFileSync(join(testDir, 'jest.config.js'), 'module.exports = {}');
        expect(detectProject(testDir).testFramework).toBe('jest');
    });

    it('detects playwright from config file', () => {
        writeFileSync(join(testDir, 'playwright.config.ts'), 'export default {}');
        expect(detectProject(testDir).testFramework).toBe('playwright');
    });

    it('detects vitest from package.json devDeps', () => {
        writeFileSync(join(testDir, 'tsconfig.json'), '{}');
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
            devDependencies: { vitest: '^1.0.0' },
        }));
        expect(detectProject(testDir).testFramework).toBe('vitest');
    });

    it('detects jest from package.json devDeps', () => {
        writeFileSync(join(testDir, 'tsconfig.json'), '{}');
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
            devDependencies: { jest: '^29.0.0' },
        }));
        expect(detectProject(testDir).testFramework).toBe('jest');
    });

    it('detects pytest from requirements.txt', () => {
        writeFileSync(join(testDir, 'requirements.txt'), 'pytest\nflask\n');
        expect(detectProject(testDir).testFramework).toBe('pytest');
    });

    it('detects pytest from pyproject.toml', () => {
        writeFileSync(join(testDir, 'pyproject.toml'), '[tool.pytest]\n');
        expect(detectProject(testDir).testFramework).toBe('pytest');
    });

    it('defaults to go test for go projects', () => {
        writeFileSync(join(testDir, 'go.mod'), 'module example.com/app\n');
        expect(detectProject(testDir).testFramework).toBe('go test');
    });

    it('defaults to cargo test for rust projects', () => {
        writeFileSync(join(testDir, 'Cargo.toml'), '[package]\n');
        expect(detectProject(testDir).testFramework).toBe('cargo test');
    });

    it('defaults to vitest for typescript with no test config', () => {
        writeFileSync(join(testDir, 'tsconfig.json'), '{}');
        expect(detectProject(testDir).testFramework).toBe('vitest');
    });
});
