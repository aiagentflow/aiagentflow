---
id: TASK-1
title: Add scripted mock provider and end-to-end runner tests
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:18'
updated_date: '2026-10-04 01:45'
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
- [x] #1 MockProvider implements LLMProvider and replays a script of responses/tool calls
- [x] #2 E2E tests cover happy path, review reject loop, test failure -> fixer, max iterations
- [x] #3 Tests run in a temp git repo, no network
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added tests/helpers/mock-provider.ts (scripted LLMProvider that replays steps, executes requested tool calls via onToolCall, records calls) and tests/core/workflow/runner.e2e.test.ts: 6 E2E tests in a temp git repo (happy path, plan handoff, review reject loop, test failure -> fixer -> pass, max iterations, session saved). createProvider is mocked; no network.
<!-- SECTION:FINAL_SUMMARY:END -->
