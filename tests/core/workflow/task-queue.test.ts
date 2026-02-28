/**
 * Tests for the task queue.
 */

import { describe, it, expect } from 'vitest';
import { parseTasks } from '../../../src/core/workflow/task-queue.js';

describe('parseTasks', () => {
  it('parses one task per line', () => {
    const input = `Build login page
Add payment flow
Write API docs`;

    const tasks = parseTasks(input);
    expect(tasks).toEqual(['Build login page', 'Add payment flow', 'Write API docs']);
  });

  it('skips empty lines and comments', () => {
    const input = `
# This is a comment
Build auth system

# Another comment
Add user profile

`;

    const tasks = parseTasks(input);
    expect(tasks).toEqual(['Build auth system', 'Add user profile']);
  });

  it('returns empty array for empty input', () => {
    expect(parseTasks('')).toEqual([]);
    expect(parseTasks('   \n\n  ')).toEqual([]);
  });

  it('trims whitespace from tasks', () => {
    const input = '  Build feature  \n  Fix bug  ';
    const tasks = parseTasks(input);
    expect(tasks).toEqual(['Build feature', 'Fix bug']);
  });
});
