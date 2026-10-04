---
id: TASK-16
title: Typed event bus and NDJSON output
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 02:53'
labels:
  - ci
  - dx
milestone: m-1
dependencies: []
priority: high
type: feature
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Emit typed events (run.started, step.started, tool.called, verdict, cost, run.finished). --output json prints NDJSON to stdout; human logs go to stderr. TUI consumes the same events.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Event types exported and documented
- [x] #2 --output json produces valid NDJSON only on stdout
- [x] #3 TUI (aiagentflow ui) reads from the event bus
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New src/core/events.ts: typed RunEvent union (run.started, step.started, tool.called, tool.result, check.finished, verdict, step.finished with usage and cost, run.finished with totals), EventBus with isolated listeners, NDJSON and file listeners, readEventLog, describeEvent. Executor and runner emit events; agents expose an onToolResult hook. Runs now save their session at start, and every run writes .aiagentflow/sessions/<id>.events.ndjson. aiagentflow run/resume --output json prints NDJSON on stdout and moves all human output (logs, spinners, previews, prompts) to stderr by redirecting process.stdout.write (verified with real pipes/files). Post-run exits use process.exitCode so piped output flushes. TUI gained an Activity feed that tails the latest run's event log. Types exported from src/types; documented in docs/events.md.
<!-- SECTION:FINAL_SUMMARY:END -->
