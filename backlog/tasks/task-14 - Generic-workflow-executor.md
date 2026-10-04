---
id: TASK-14
title: Generic workflow executor
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 02:44'
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
- [x] #1 runner.ts delegates to the executor; hardcoded state map removed
- [x] #2 Resume works mid-workflow for any definition
- [x] #3 All existing E2E tests pass on the standard workflow
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New src/core/workflow/executor.ts runs any workflow definition: agent → apply output (by role) → checks (format/lint/test) → verdict gate → route to onFail (one iteration) or next. The hardcoded 14-state machine, STATE_AGENT_MAP, transition() and getNextAgent() are gone; engine.ts now holds the run context (workflow, status running|passed|failed, step, history of step records, lastFailure, changeSummary) plus normalizeContext, which converts v1 sessions (state → status, resumable states → matching standard step) on load. runner.ts shrank to setup/resume/worktree/summary around executeWorkflow; RunOptions.workflow selects a workflow. Step review gate generalised (requestStepReview) for approval:true steps and approvalGates roles; 'retry' at the human checkpoint now actually reruns the step (v1 ignored it). Fixer now receives the latest failure instead of possibly stale review feedback. v1 bug fixed: coder lint failures hit an invalid transition and aborted. Consumers updated: sessions, runs (--filter running|passed|failed, complete kept as alias), export (step timeline, workflow, failureReason), TUI, run/resume exit codes, task queue. Tests: all existing E2E pass on the standard workflow; new E2E for a project workflow, resuming a custom workflow mid-run, and resuming a v1 session.
<!-- SECTION:FINAL_SUMMARY:END -->
