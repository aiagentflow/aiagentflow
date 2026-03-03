import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectPackageManager, buildTestCommand } from '../../src/utils/package-manager.js';

let testDir: string;

beforeEach(() => {
    testDir = join(tmpdir(), `aiagentflow-pm-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
});

describe('detectPackageManager', () => {
    it('detects bun from bun.lockb', () => {
        writeFileSync(join(testDir, 'bun.lockb'), '');
        expect(detectPackageManager(testDir)).toEqual({ name: 'bun', execPrefix: 'bun' });
    });

    it('detects bun from bun.lock', () => {
        writeFileSync(join(testDir, 'bun.lock'), '');
        expect(detectPackageManager(testDir)).toEqual({ name: 'bun', execPrefix: 'bun' });
    });

    it('detects pnpm from pnpm-lock.yaml', () => {
        writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');
        expect(detectPackageManager(testDir)).toEqual({ name: 'pnpm', execPrefix: 'pnpm exec' });
    });

    it('detects yarn from yarn.lock', () => {
        writeFileSync(join(testDir, 'yarn.lock'), '');
        expect(detectPackageManager(testDir)).toEqual({ name: 'yarn', execPrefix: 'yarn' });
    });

    it('detects npm from package-lock.json', () => {
        writeFileSync(join(testDir, 'package-lock.json'), '{}');
        expect(detectPackageManager(testDir)).toEqual({ name: 'npm', execPrefix: 'npx' });
    });

    it('defaults to npm when no lockfile exists', () => {
        expect(detectPackageManager(testDir)).toEqual({ name: 'npm', execPrefix: 'npx' });
    });

    it('prefers bun over npm when both lockfiles exist', () => {
        writeFileSync(join(testDir, 'bun.lockb'), '');
        writeFileSync(join(testDir, 'package-lock.json'), '{}');
        expect(detectPackageManager(testDir).name).toBe('bun');
    });

    it('prefers pnpm over yarn when both lockfiles exist', () => {
        writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');
        writeFileSync(join(testDir, 'yarn.lock'), '');
        expect(detectPackageManager(testDir).name).toBe('pnpm');
    });
});

describe('buildTestCommand', () => {
    it('prefixes vitest with bun when bun.lockb exists', () => {
        writeFileSync(join(testDir, 'bun.lockb'), '');
        expect(buildTestCommand('vitest', testDir)).toBe('bun vitest run');
    });

    it('prefixes vitest with pnpm exec when pnpm-lock.yaml exists', () => {
        writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');
        expect(buildTestCommand('vitest', testDir)).toBe('pnpm exec vitest run');
    });

    it('prefixes jest with yarn when yarn.lock exists', () => {
        writeFileSync(join(testDir, 'yarn.lock'), '');
        expect(buildTestCommand('jest', testDir)).toBe('yarn jest');
    });

    it('prefixes vitest with npx when package-lock.json exists', () => {
        writeFileSync(join(testDir, 'package-lock.json'), '{}');
        expect(buildTestCommand('vitest', testDir)).toBe('npx vitest run');
    });

    it('returns static command for non-JS frameworks', () => {
        writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');
        expect(buildTestCommand('pytest', testDir)).toBe('pytest');
        expect(buildTestCommand('go test', testDir)).toBe('go test ./...');
        expect(buildTestCommand('cargo test', testDir)).toBe('cargo test');
        expect(buildTestCommand('junit', testDir)).toBe('mvn test');
    });

    it('falls back to npm test for unknown frameworks', () => {
        expect(buildTestCommand('unknown', testDir)).toBe('npm test');
    });
});
