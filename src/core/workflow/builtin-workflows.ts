/**
 * Workflows that ship with the CLI.
 *
 * Kept as YAML so they double as reference examples: `aiagentflow workflow
 * show standard` prints them, and users copy them into
 * `.aiagentflow/workflows/` to customise.
 *
 * Dependency direction: builtin-workflows.ts → nothing
 * Used by: workflow loader
 */

export const BUILTIN_WORKFLOWS: Readonly<Record<string, string>> = {
    standard: `name: standard
description: Plan, implement, review, security check, test, and judge, with fix loops.

steps:
  - id: plan
    agent: architect
    description: Analyze the task and write an implementation plan

  - id: implement
    agent: coder
    description: Implement the plan
    checks: [format, lint]
    onFail: fix

  - id: review
    agent: reviewer
    description: Review the changes
    gate: verdict
    onFail: fix

  - id: security
    agent: security
    description: Check the changes for vulnerabilities
    gate: verdict
    onFail: fix

  - id: test
    agent: tester
    description: Write tests and run the test suite
    checks: [test]
    onFail: fix

  - id: judge
    agent: judge
    description: Decide whether the task is done
    gate: verdict
    onFail: fix

  - id: fix
    agent: fixer
    description: Fix review findings, security findings, and test failures
    trigger: on-fail
    checks: [format]
    next: review
`,

    fast: `name: fast
description: Implement and test, fixing until the tests pass. No planning or review.

steps:
  - id: implement
    agent: coder
    description: Implement the task
    checks: [format, lint]
    onFail: fix

  - id: test
    agent: tester
    description: Write tests and run the test suite
    checks: [test]
    onFail: fix

  - id: fix
    agent: fixer
    description: Fix lint errors and test failures
    trigger: on-fail
    checks: [format]
    next: test
`,

    review: `name: review
description: Review existing changes without editing anything. Fails on a negative verdict.

steps:
  - id: review
    agent: reviewer
    description: Review the changes for bugs and quality
    gate: verdict

  - id: security
    agent: security
    description: Check the changes for vulnerabilities
    gate: verdict
`,

    'security-audit': `name: security-audit
description: Audit the whole repository for vulnerabilities. Read-only; fails on a negative verdict.

steps:
  - id: audit
    agent: security
    description: Explore the codebase and report vulnerabilities
    gate: verdict
    maxTurns: 30
`,
};
