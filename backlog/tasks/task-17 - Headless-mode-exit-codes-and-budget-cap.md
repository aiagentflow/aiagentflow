---
id: TASK-17
title: 'Headless mode, exit codes, and budget cap'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 03:00'
labels:
  - ci
milestone: m-1
dependencies:
  - TASK-16
priority: high
type: feature
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
--headless: no prompts ever, ask-permissions resolve to deny. Stable exit codes (0 pass, 1 gate failed, 2 config error, 3 budget exceeded, 4 provider error). --max-cost USD and --max-time.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No interactive prompt reachable in headless mode
- [x] #2 Exit codes documented and tested
- [x] #3 Run aborts cleanly with partial report when budget exceeded
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Found during lint cleanup: batch --budget is a no-op. executeTask in src/core/workflow/task-queue.ts never calls budgetTracker.record (item.tokensUsed = 0), so BudgetTracker.exceeded never trips. Fix as part of this task by returning token totals from runWorkflow.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
--headless on run/resume: never prompts, implies --auto, approval-needing commands denied, resume recreates a missing worktree instead of asking (E2E mocks prompts to throw for every auto/headless run). Exit codes 0 pass / 1 workflow failed / 2 config-usage / 3 budget / 4 provider, via cli/utils/exit-codes.ts and new WorkflowContext.failureKind (checks|budget|provider|aborted|error). Budgets: --max-tokens/--max-cost/--max-time for single and batch runs; checked before each step and after every model turn (BaseAgent.onTurn throws BudgetExceededError, which now passes through BaseAgent unchanged and is not retried by the streaming fallback); partial spend is recorded; run ends failed with kind budget and full session/report. Fixed the batch budget no-op: tasks now record real usage (WorkflowContext.usage), each task gets the remaining budget, and BudgetTracker's crude per-model rate table is gone. Task queue refactored to pass one SharedRunOptions slice. run command rewritten around a run() returning an exit code. Documented in docs/headless.md.
<!-- SECTION:FINAL_SUMMARY:END -->
