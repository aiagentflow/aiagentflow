---
id: TASK-27
title: 'External agent steps (Claude Code, Codex, OpenCode)'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 11:43'
labels:
  - interop
  - workflow
milestone: m-3
dependencies:
  - TASK-14
priority: high
type: feature
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A workflow step can use runtime: external with an adapter that invokes another agent CLI headlessly in the worktree, captures the diff, then aiagentflow gates (review, security, tests, judge) run as usual. See decision-2.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Adapter interface + adapters for at least 2 CLIs
- [x] #2 Diff and cost (if reported) captured in session
- [x] #3 Gate failures feed back to the external agent on retry
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Workflow steps for coder/fixer/tester accept external: { cli: claude-code | opencode | command, model?, args?, bin?, timeoutMinutes? } (src/agents/external.ts). Claude Code and OpenCode flags were checked against the installed CLIs' --help (Claude Code 2.1.289, OpenCode 1.0.162); Codex is not installed here, so it is supported through the generic command adapter ({prompt} placeholder) rather than guessed flags. The external CLI runs in the run directory (worktree by default); changed files are found by hashing git modified/untracked files before and after; the git diff (truncated) and reported cost go into WorkflowContext.external and the token tracker (new costUsd override). Output then goes through the same applyOutput/checks as built-in agents, so gate and test failures reach an external fixer through its prompt. Tests use fake CLI scripts, including an E2E where coding and fixing are delegated and the built-in tester gates them. Not run against real Claude Code/OpenCode sessions (would spend the user's account).
<!-- SECTION:FINAL_SUMMARY:END -->
