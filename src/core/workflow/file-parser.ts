/**
 * File parser — extracts code blocks from agent output and writes to disk.
 *
 * Agents output code in a structured format:
 *   FILE: path/to/file.ts
 *   ```
 *   <code content>
 *   ```
 *
 * This module parses that format and writes files to the project directory.
 *
 * Dependency direction: file-parser.ts → utils/fs, core/errors
 * Used by: workflow runner
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { logger } from '../../utils/logger.js';

/** A parsed file extracted from agent output. */
export interface ParsedFile {
  /** Relative path from project root. */
  path: string;
  /** File contents. */
  content: string;
}

/**
 * Parse agent output to extract file blocks.
 *
 * Supports two formats:
 * 1. FILE: path/to/file.ts followed by a fenced code block
 * 2. ```language:path/to/file.ts (language annotation with path)
 */
export function parseFiles(output: string): ParsedFile[] {
  const files: ParsedFile[] = [];

  // Pattern 1: FILE: path\n```\ncontent\n```
  const fileBlockPattern = /FILE:\s*(.+?)\n```[\w]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  match = fileBlockPattern.exec(output);
  while (match !== null) {
    const path = match[1]?.trim();
    const content = match[2];
    if (path && content) {
      files.push({ path, content });
    }
    match = fileBlockPattern.exec(output);
  }

  // Pattern 2: ```language:path/to/file.ts\ncontent\n```
  if (files.length === 0) {
    const annotatedPattern = /```\w+:(.+?)\n([\s\S]*?)```/g;
    match = annotatedPattern.exec(output);
    while (match !== null) {
      const path = match[1]?.trim();
      const content = match[2];
      if (path && content) {
        files.push({ path, content });
      }
      match = annotatedPattern.exec(output);
    }
  }

  // Pattern 3: Code block with "// filename.ts" or "# filename.py" as first line
  if (files.length === 0) {
    const codeBlockPattern = /```\w*\n([\s\S]*?)```/g;
    match = codeBlockPattern.exec(output);
    while (match !== null) {
      const content = match[1] ?? '';
      const firstLine = content.split('\n')[0]?.trim() ?? '';

      // Extract filename from "// filename.ts" or "# filename.py" comments
      const commentMatch = firstLine.match(/^(?:\/\/|#)\s*(.+\.\w+)\s*$/);
      if (commentMatch?.[1]) {
        files.push({ path: commentMatch[1], content });
      }
      match = codeBlockPattern.exec(output);
    }
  }

  // Pattern 4: Markdown heading with filename before code block
  // e.g., **hello.ts** or ### hello.ts followed by ```
  if (files.length === 0) {
    const headingPattern = /(?:\*\*|#{1,4}\s*)([^\s*]+\.\w+)\*{0,2}\s*\n+```\w*\n([\s\S]*?)```/g;
    match = headingPattern.exec(output);
    while (match !== null) {
      const path = match[1]?.trim();
      const content = match[2];
      if (path && content) {
        files.push({ path, content });
      }
      match = headingPattern.exec(output);
    }
  }

  // Pattern 5: Inline filename reference before code block
  // e.g., `greeting.ts`:  or  Here is greeting.ts:  or  (greeting.ts)
  if (files.length === 0) {
    const inlinePattern = /`([^\s`]+\.\w{1,4})`[:\s]*\n+```\w*\n([\s\S]*?)```/g;
    match = inlinePattern.exec(output);
    while (match !== null) {
      const path = match[1]?.trim();
      const content = match[2];
      if (path && content) {
        files.push({ path, content });
      }
      match = inlinePattern.exec(output);
    }
  }

  if (files.length === 0) {
    logger.debug(
      'File parser: no patterns matched. Output preview: ' +
        output.substring(0, 200).replace(/\n/g, '\\n'),
    );
  }

  return files;
}

/**
 * Validate that a file path is safe and within the project root.
 * Prevents path traversal attacks by resolving the path and checking it stays within bounds.
 */
function validatePath(projectRoot: string, filePath: string): boolean {
  try {
    // Skip empty, null, or undefined paths
    if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
      return false;
    }

    // Skip paths that resolve to the project root itself (directory)
    const resolvedFilePath = resolve(projectRoot, filePath);
    const resolvedProjectRoot = resolve(projectRoot);

    // Check if the resolved file path is within the project root and not the root itself
    return (
      resolvedFilePath.startsWith(resolvedProjectRoot) && resolvedFilePath !== resolvedProjectRoot
    );
  } catch {
    // If path resolution fails, consider it invalid
    return false;
  }
}

/**
 * Write parsed files to disk under the project root.
 *
 * Creates parent directories as needed. Returns the list of written file paths.
 */
export function writeFiles(projectRoot: string, files: ParsedFile[]): string[] {
  const writtenPaths: string[] = [];

  for (const file of files) {
    // Prevent path traversal with comprehensive validation
    if (!validatePath(projectRoot, file.path)) {
      logger.warn(`Skipping file with invalid path: ${file.path}`);
      continue;
    }

    const absolutePath = join(projectRoot, file.path);
    const dir = dirname(absolutePath);

    mkdirSync(dir, { recursive: true });
    writeFileSync(absolutePath, file.content, 'utf-8');

    writtenPaths.push(file.path);
    logger.debug(`Wrote: ${file.path}`);
  }

  if (writtenPaths.length > 0) {
    logger.info(`Wrote ${writtenPaths.length} file(s)`);
  }

  return writtenPaths;
}

/**
 * Parse agent output and write extracted files to disk.
 * Combines parseFiles + writeFiles in one call.
 */
export function parseAndWriteFiles(projectRoot: string, output: string): string[] {
  const files = parseFiles(output);

  if (files.length === 0) {
    logger.debug('No file blocks found in agent output');
    return [];
  }

  return writeFiles(projectRoot, files);
}
