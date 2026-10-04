---
id: TASK-31
title: Upgrade major dependencies
status: To Do
assignee: []
created_date: '2026-10-04 06:21'
labels:
  - deps
dependencies: []
priority: low
type: chore
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deferred from task-23 (in-range updates only there). Each has breaking changes and deserves its own PR: zod 4, typescript 7, vitest 5, eslint 10, commander 15, execa 10, ink 8, chalk 6, ora 9, simple-git 4, @types/node to match the minimum Node version.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 One PR per major upgrade (or tightly related group)
- [ ] #2 typecheck, lint, tests green after each
<!-- AC:END -->
