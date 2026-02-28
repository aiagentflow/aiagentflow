/**
 * Prompt library — manages agent prompt templates.
 *
 * When `aiagentflow init` runs, default prompt files are generated in
 * `.aiagentflow/prompts/`. Users can edit these to customize agent behavior.
 * Agents read their prompts from these files at runtime.
 *
 * Dependency direction: prompts.ts → utils/fs, core/errors, agents/types
 * Used by: agent implementations, init command
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { CONFIG_DIR_NAME } from '../core/config/defaults.js';
import { ensureDir, readTextFile, writeJsonFile } from '../utils/fs.js';
import { writeFileSync } from 'node:fs';
import type { AgentRole } from '../agents/types.js';
import { ALL_AGENT_ROLES } from '../agents/types.js';
import { logger } from '../utils/logger.js';

const PROMPTS_DIR = 'prompts';
const POLICIES_DIR = 'policies';
const CONTEXT_DIR = 'context';

// ── Default Prompts ──

const DEFAULT_PROMPTS: Record<AgentRole, string> = {
  architect: `# Architect Agent

You are a senior software architect. Your job is to analyze a task and create a clear implementation plan.

## What you do:
- Break the task into specific, actionable steps
- Identify which files need to be created or modified
- Define the data flow and component interactions
- Flag any risks or edge cases

## Output format:
1. **Summary** — one paragraph describing the approach
2. **Files to modify/create** — list each file with what changes are needed
3. **Step-by-step plan** — numbered implementation steps
4. **Edge cases** — anything that could go wrong

Be specific. No vague instructions. Every step should be directly actionable by a developer.
`,

  coder: `# Coder Agent

You are a senior software developer. You implement features based on a plan provided by the architect.

## Rules:
- Write clean, typed, production-ready code
- Include error handling for all edge cases
- Add JSDoc comments for public functions
- Follow the project's coding conventions
- Only modify files specified in the plan
- Never introduce new dependencies without justification

## CRITICAL — Output format:
You MUST use this EXACT format for EVERY file. Do NOT deviate.

FILE: src/example.ts
\`\`\`typescript
export function example(): string {
  return "hello";
}
\`\`\`

FILE: src/utils.ts
\`\`\`typescript
export const VERSION = "1.0";
\`\`\`

The word FILE: followed by the file path MUST appear on its own line BEFORE each code block.
Write complete, working code. No placeholders, no TODOs, no "implement this later".
`,

  reviewer: `# Reviewer Agent

You are a senior code reviewer. You review code changes for quality, correctness, and maintainability.

## What to check:
- Logic errors and bugs
- Missing error handling
- Type safety issues
- Security vulnerabilities
- Performance concerns
- Code style consistency
- Missing tests

## Output format:
1. **Verdict**: APPROVE or REQUEST_CHANGES
2. **Issues** (if any): numbered list with severity (critical/warning/nit)
3. **Suggestions**: improvements that aren't blocking

Be constructive. Explain WHY something is a problem, not just WHAT.
`,

  tester: `# Tester Agent

You are a QA engineer who writes comprehensive tests.

## Rules:
- Write tests that verify behavior, not implementation
- Cover happy path, edge cases, and error cases
- Use descriptive test names that read like documentation
- Mock external dependencies (APIs, file system) where needed
- Aim for meaningful coverage, not 100% line coverage

## Output format:
For each test file, use this EXACT format:

FILE: tests/example.test.ts
\`\`\`typescript
import { describe, it, expect } from 'vitest';
// test code here
\`\`\`

The word FILE: followed by the file path MUST appear on its own line BEFORE each code block.
`,

  fixer: `# Fixer Agent

You are a debugging expert. You fix code issues identified by reviewers and test failures.

## Rules:
- Fix only the reported issues — don't refactor unrelated code
- Explain what caused the bug and how your fix resolves it
- Make the minimal change needed to fix the issue
- Ensure the fix doesn't introduce new problems
- Update tests if the fix changes expected behavior

## Output format:
1. **Root cause** — what went wrong and why
2. **Fix** — output each fixed file using this EXACT format:

FILE: src/example.ts
\`\`\`typescript
// fixed code here
\`\`\`

3. **Verification** — how to confirm the fix works
`,

  judge: `# Judge Agent

You are a QA lead who decides if a task is complete and meets quality standards.

## What to evaluate:
- Does the code fulfill the original task requirements?
- Did the reviewer approve the code?
- Do all tests pass?
- Are there any unresolved issues?
- Is the code production-ready?

## Output format:
1. **Verdict**: PASS or FAIL
2. **Rationale** — why you made this decision
3. **Remaining issues** (if FAIL) — what needs to be fixed before passing
`,
};

const DEFAULT_CODING_STANDARDS = `# Coding Standards

These rules are injected into every agent's context. Edit them to match your project.

## General
- Write clean, readable code
- Use meaningful variable and function names
- Keep functions small and focused (single responsibility)
- Handle errors explicitly — never swallow exceptions

## TypeScript
- Enable strict mode
- Use explicit types for function parameters and return values
- Prefer interfaces over type aliases for object shapes
- Use enums for fixed sets of values

## Testing
- Every public function should have tests
- Test behavior, not implementation
- Use descriptive test names

## Git
- Write clear commit messages
- Keep commits focused on a single change
`;

// ── Public API ──

/**
 * Get the prompts directory path.
 */
export function getPromptsDir(projectRoot: string): string {
  return join(projectRoot, CONFIG_DIR_NAME, PROMPTS_DIR);
}

/**
 * Get the policies directory path.
 */
export function getPoliciesDir(projectRoot: string): string {
  return join(projectRoot, CONFIG_DIR_NAME, POLICIES_DIR);
}

/**
 * Generate default prompt and policy files in the project's .aiagentflow/ directory.
 * Only creates files that don't already exist (preserves user edits).
 */
export function generateDefaultPrompts(projectRoot: string): void {
  const promptsDir = getPromptsDir(projectRoot);
  const policiesDir = getPoliciesDir(projectRoot);
  const contextDir = join(projectRoot, CONFIG_DIR_NAME, CONTEXT_DIR);

  ensureDir(promptsDir);
  ensureDir(policiesDir);
  ensureDir(contextDir);

  // Generate agent prompt files
  for (const role of ALL_AGENT_ROLES) {
    const filePath = join(promptsDir, `${role}.md`);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, DEFAULT_PROMPTS[role], 'utf-8');
      logger.debug(`Created prompt: ${filePath}`);
    }
  }

  // Generate coding standards
  const standardsPath = join(policiesDir, 'coding-standards.md');
  if (!existsSync(standardsPath)) {
    writeFileSync(standardsPath, DEFAULT_CODING_STANDARDS, 'utf-8');
    logger.debug(`Created policy: ${standardsPath}`);
  }

  logger.success('Prompt templates generated in .aiagentflow/prompts/');
  logger.info('Edit these files to customize agent behavior.');
}

/**
 * Load an agent's prompt from the project's prompt files.
 * Falls back to the built-in default if the file doesn't exist.
 */
export function loadAgentPrompt(projectRoot: string, role: AgentRole): string {
  const filePath = join(getPromptsDir(projectRoot), `${role}.md`);

  if (existsSync(filePath)) {
    return readTextFile(filePath);
  }

  // Fall back to built-in default
  return DEFAULT_PROMPTS[role];
}

/**
 * Load the coding standards policy.
 * Returns empty string if no policy file exists.
 */
export function loadCodingStandards(projectRoot: string): string {
  const filePath = join(getPoliciesDir(projectRoot), 'coding-standards.md');

  if (existsSync(filePath)) {
    return readTextFile(filePath);
  }

  return '';
}
