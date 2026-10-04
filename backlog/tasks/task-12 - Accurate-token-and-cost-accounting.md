---
id: TASK-12
title: Accurate token and cost accounting
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
labels:
  - runtime
milestone: m-0
dependencies:
  - TASK-6
priority: medium
type: enhancement
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Streaming estimates tokens as chars/4. Read real usage (incl. cache read/write tokens) from every provider, across all tool-loop turns.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No chars/4 estimate when the provider reports usage
- [ ] #2 Cache tokens tracked and priced
- [ ] #3 Run summary totals match provider-reported usage
<!-- AC:END -->
