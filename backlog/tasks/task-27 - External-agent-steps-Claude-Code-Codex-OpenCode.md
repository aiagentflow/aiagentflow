---
id: TASK-27
title: 'External agent steps (Claude Code, Codex, OpenCode)'
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
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
- [ ] #1 Adapter interface + adapters for at least 2 CLIs
- [ ] #2 Diff and cost (if reported) captured in session
- [ ] #3 Gate failures feed back to the external agent on retry
<!-- AC:END -->
