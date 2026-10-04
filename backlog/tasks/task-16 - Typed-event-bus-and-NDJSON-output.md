---
id: TASK-16
title: Typed event bus and NDJSON output
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
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
- [ ] #1 Event types exported and documented
- [ ] #2 --output json produces valid NDJSON only on stdout
- [ ] #3 TUI (aiagentflow ui) reads from the event bus
<!-- AC:END -->
