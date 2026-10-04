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
};
