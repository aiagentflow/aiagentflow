---
id: TASK-30
title: Watch mode
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 11:59'
labels:
  - dx
milestone: m-3
dependencies:
  - TASK-17
priority: low
type: feature
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
aiagentflow watch: rerun a chosen workflow (e.g. review on staged changes) on file save, debounced. From the v1 README roadmap.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Debounced, respects .gitignore
- [x] #2 Only one run at a time; cancels stale runs
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
aiagentflow watch: re-reviews uncommitted (or --staged) changes after each burst of saves, or re-runs a task with --task/--workflow. src/watch/scheduler.ts (no fs code, fake-timer tested): debounce, one run at a time, cancel-on-change for read-only reviews (aborts via RunOptions.signal, re-runs after), queue-without-cancel for task runs, and the run's own edited files never trigger another run. src/watch/watcher.ts: recursive fs.watch; .git/.aiagentflow/node_modules skipped; git check-ignore filters ignored paths (all kept outside git). review gained a signal pass-through. Docs in docs/review.md; changelog now lists the v2.1 interop features in 2.0.0 since they ship together.
<!-- SECTION:FINAL_SUMMARY:END -->
