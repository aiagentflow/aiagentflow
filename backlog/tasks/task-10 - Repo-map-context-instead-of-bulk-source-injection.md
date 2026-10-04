---
id: TASK-10
title: Repo map context instead of bulk source injection
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
labels:
  - runtime
  - context
milestone: m-0
dependencies:
  - TASK-7
priority: medium
type: feature
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
loadSourceFiles dumps source into prompts. Replace with a compact repo map (tree + exported symbols per file, token-budgeted); agents pull details with read_file/grep.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Repo map respects .gitignore and a token budget
- [ ] #2 Code agents no longer receive full source by default
- [ ] #3 Prompt tokens on fixture repo drop measurably
<!-- AC:END -->
