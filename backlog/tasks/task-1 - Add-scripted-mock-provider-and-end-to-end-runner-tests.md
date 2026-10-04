---
id: TASK-1
title: Add scripted mock provider and end-to-end runner tests
status: To Do
assignee: []
created_date: '2026-10-04 01:18'
labels:
  - testing
milestone: m-0
dependencies: []
priority: high
type: task
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
runner.ts (983 lines) has no end-to-end coverage. Before refactoring the core, add a MockProvider that replays scripted responses (incl. tool calls) and tests the full pipeline. Safety net for every v2 change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 MockProvider implements LLMProvider and replays a script of responses/tool calls
- [ ] #2 E2E tests cover happy path, review reject loop, test failure -> fixer, max iterations
- [ ] #3 Tests run in a temp git repo, no network
<!-- AC:END -->
