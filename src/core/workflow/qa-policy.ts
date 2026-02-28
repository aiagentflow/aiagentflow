/**
 * QA policies — configurable quality acceptance rules.
 *
 * Defines rules that the judge agent uses to evaluate work quality.
 * Users can customize these via `.aiagentflow/policies/qa-rules.md`
 * or through config options.
 *
 * Dependency direction: qa-policy.ts → config/types, utils
 * Used by: judge agent, workflow runner
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { CONFIG_DIR_NAME } from '../config/defaults.js';
import { readTextFile } from '../../utils/fs.js';
import { logger } from '../../utils/logger.js';

/** QA policy configuration. */
export interface QAPolicy {
  /** Minimum test coverage percentage (0-100). 0 = disabled. */
  minTestCoverage: number;
  /** Require all tests to pass before approval. */
  requireAllTestsPass: boolean;
  /** Require reviewer approval before proceeding. */
  requireReviewApproval: boolean;
  /** Maximum allowed critical issues from reviewer. */
  maxCriticalIssues: number;
  /** Maximum allowed warnings from reviewer. */
  maxWarnings: number;
  /** Custom rules loaded from policy file. */
  customRules: string;
}

/** Default QA policy settings. */
export const DEFAULT_QA_POLICY: QAPolicy = {
  minTestCoverage: 0,
  requireAllTestsPass: true,
  requireReviewApproval: true,
  maxCriticalIssues: 0,
  maxWarnings: 5,
  customRules: '',
};

const POLICIES_DIR = 'policies';
const QA_RULES_FILE = 'qa-rules.md';

/**
 * Load QA policy from project config and policy files.
 * Merges config defaults with user-defined policy file.
 */
export function loadQAPolicy(projectRoot: string, overrides?: Partial<QAPolicy>): QAPolicy {
  const policy = { ...DEFAULT_QA_POLICY, ...overrides };

  // Load custom rules from policy file
  const rulesPath = join(projectRoot, CONFIG_DIR_NAME, POLICIES_DIR, QA_RULES_FILE);
  if (existsSync(rulesPath)) {
    policy.customRules = readTextFile(rulesPath);
    logger.debug(`Loaded QA rules from ${rulesPath}`);
  }

  return policy;
}

/**
 * Evaluate review output against the QA policy.
 *
 * Returns whether the review passes the policy requirements.
 */
export function evaluateReview(reviewContent: string, policy: QAPolicy): QAEvaluation {
  const issues = parseReviewIssues(reviewContent);
  const criticalCount = issues.filter((i) => i.severity === 'critical').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  const passed = criticalCount <= policy.maxCriticalIssues && warningCount <= policy.maxWarnings;

  return {
    passed,
    criticalCount,
    warningCount,
    totalIssues: issues.length,
    issues,
  };
}

/**
 * Format the QA policy as context for the judge agent.
 */
export function formatPolicyForAgent(policy: QAPolicy): string {
  const rules: string[] = ['## QA Acceptance Criteria', ''];

  if (policy.requireAllTestsPass) {
    rules.push('- All tests MUST pass');
  }
  if (policy.requireReviewApproval) {
    rules.push('- Code review MUST be approved');
  }
  if (policy.maxCriticalIssues === 0) {
    rules.push('- Zero critical issues allowed');
  } else {
    rules.push(`- Maximum ${policy.maxCriticalIssues} critical issue(s) allowed`);
  }
  if (policy.maxWarnings < 999) {
    rules.push(`- Maximum ${policy.maxWarnings} warning(s) allowed`);
  }
  if (policy.minTestCoverage > 0) {
    rules.push(`- Minimum test coverage: ${policy.minTestCoverage}%`);
  }

  if (policy.customRules) {
    rules.push('', '## Custom Project Rules', '', policy.customRules);
  }

  return rules.join('\n');
}

// ── Internal types ──

export interface QAEvaluation {
  passed: boolean;
  criticalCount: number;
  warningCount: number;
  totalIssues: number;
  issues: ReviewIssue[];
}

interface ReviewIssue {
  severity: 'critical' | 'warning' | 'nit';
  description: string;
}

/**
 * Parse a review output to extract issues with severity.
 *
 * Matches only structured issue markers where the severity keyword
 * appears as a label at the start of a line (optionally bulleted/numbered),
 * e.g.:
 * - **CRITICAL**: description
 * - CRITICAL: description
 * - 1. WARNING: description
 * - NIT: description
 *
 * Does NOT match casual mentions like "no critical issues found".
 */
function parseReviewIssues(content: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const lines = content.split('\n');

  // Matches lines where severity keyword appears as a structured label:
  // Optional leading bullet/number, optional markdown bold, then KEYWORD followed by colon
  const issuePattern = /^\s*(?:[-*•]|\d+[.)]\s*)?\s*\*{0,2}(CRITICAL|WARNING|NIT)\*{0,2}\s*:/i;

  for (const line of lines) {
    const match = line.match(issuePattern);
    if (match?.[1]) {
      const severity = match[1].toLowerCase() as 'critical' | 'warning' | 'nit';
      issues.push({ severity, description: line.trim() });
    }
  }

  return issues;
}
