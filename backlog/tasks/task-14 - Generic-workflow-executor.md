---
id: TASK-14
title: Generic workflow executor
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
labels:
  - workflow
  - refactor
milestone: m-1
dependencies:
  - TASK-13
  - TASK-11
  - TASK-1
priority: high
type: enhancement
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the hardcoded 14-state machine and STATE_AGENT_MAP in engine.ts/runner.ts with an executor that runs a workflow definition. Sessions/resume, worktrees, parallel batch, plan review keep working.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 runner.ts delegates to the executor; hardcoded state map removed
- [ ] #2 Resume works mid-workflow for any definition
- [ ] #3 All existing E2E tests pass on the standard workflow
<!-- AC:END -->
