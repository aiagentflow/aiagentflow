---
id: TASK-30
title: Watch mode
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
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
- [ ] #1 Debounced, respects .gitignore
- [ ] #2 Only one run at a time; cancels stale runs
<!-- AC:END -->
