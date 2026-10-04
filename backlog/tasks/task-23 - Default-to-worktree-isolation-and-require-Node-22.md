---
id: TASK-23
title: Default to worktree isolation and require Node 22
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
labels:
  - breaking
milestone: m-2
dependencies: []
priority: medium
type: chore
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Flip isolation default to worktree (planned in PLAN_V2 for 2.0). engines.node >=22. Refresh dependencies.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 isolation defaults to worktree; --inplace opt-out
- [ ] #2 engines >=22 and CI matrix updated
- [ ] #3 Deps updated, tests green
<!-- AC:END -->
