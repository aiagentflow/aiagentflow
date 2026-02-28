import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeFiles, parseFiles } from '../../src/core/workflow/file-parser.js';

describe('Security Tests for File Parser', () => {
  const testDir = './temp-security-test';
  const projectRoot = join(testDir, 'project');

  beforeEach(() => {
    // Create test directory structure
    mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Path Traversal Protection', () => {
    it('should block relative path traversal attempts', () => {
      const files = [
        { path: '../../../etc/passwd', content: 'malicious content' },
        { path: '../../secrets.txt', content: 'secret data' },
        { path: '../config.json', content: 'config data' },
      ];

      const writtenPaths = writeFiles(projectRoot, files);

      // No files should be written due to path validation
      expect(writtenPaths).toHaveLength(0);
    });

    it('should block absolute path traversal attempts', () => {
      const files = [
        { path: '/etc/passwd', content: 'malicious content' },
        { path: '/tmp/secret.txt', content: 'secret data' },
      ];

      const writtenPaths = writeFiles(projectRoot, files);

      // No files should be written due to path validation
      expect(writtenPaths).toHaveLength(0);
    });

    it('should allow legitimate file paths within project root', () => {
      const files = [
        { path: 'src/index.ts', content: 'export function main() {}' },
        { path: 'src/utils/helper.ts', content: 'export function helper() {}' },
        { path: 'README.md', content: '# Project' },
        { path: 'config/app.json', content: '{"name": "test"}' },
      ];

      const writtenPaths = writeFiles(projectRoot, files);

      // All legitimate files should be written
      expect(writtenPaths).toHaveLength(4);
      expect(writtenPaths).toContain('src/index.ts');
      expect(writtenPaths).toContain('src/utils/helper.ts');
      expect(writtenPaths).toContain('README.md');
      expect(writtenPaths).toContain('config/app.json');

      // Verify files actually exist
      expect(existsSync(join(projectRoot, 'src/index.ts'))).toBe(true);
      expect(existsSync(join(projectRoot, 'src/utils/helper.ts'))).toBe(true);
      expect(existsSync(join(projectRoot, 'README.md'))).toBe(true);
      expect(existsSync(join(projectRoot, 'config/app.json'))).toBe(true);
    });

    it('should handle edge cases like symbolic link paths', () => {
      const files = [
        { path: 'normal-file.txt', content: 'normal content' },
        { path: './subdir/../../../etc/passwd', content: 'malicious content' },
        { path: 'subdir/../normal-file2.txt', content: 'normal content 2' },
      ];

      const writtenPaths = writeFiles(projectRoot, files);

      // Only legitimate files should be written
      expect(writtenPaths).toHaveLength(2);
      expect(writtenPaths).toContain('normal-file.txt');
      expect(writtenPaths).toContain('subdir/../normal-file2.txt');
    });
  });

  describe('Input Validation', () => {
    it('should handle empty and null paths safely', () => {
      const files = [
        { path: '', content: 'content' },
        { path: null as any, content: 'content' },
        { path: undefined as any, content: 'content' },
      ];

      // Should not throw and should skip invalid paths
      expect(() => writeFiles(projectRoot, files)).not.toThrow();
      const writtenPaths = writeFiles(projectRoot, files);
      expect(writtenPaths).toHaveLength(0);
    });

    it('should handle special characters in paths', () => {
      const files = [
        { path: 'file with spaces.txt', content: 'content' },
        { path: 'file-with-dashes.txt', content: 'content' },
        { path: 'file_with_underscores.txt', content: 'content' },
        { path: 'file.with.dots.txt', content: 'content' },
      ];

      const writtenPaths = writeFiles(projectRoot, files);

      // Files with special characters should be allowed if they're within project root
      expect(writtenPaths).toHaveLength(4);
    });
  });
});
