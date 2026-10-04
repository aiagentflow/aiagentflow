---
id: TASK-23
title: Default to worktree isolation and require Node 22
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 06:21'
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
- [x] #1 isolation defaults to worktree; --inplace opt-out
- [x] #2 engines >=22 and CI matrix updated
- [x] #3 Deps updated, tests green
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
workflow.isolation now defaults to worktree (schema and DEFAULT_CONFIG); non-git projects or repos without commits still run in place. New run --inplace (alias of --no-isolate). Because a worktree starts from the last commit, the runner now warns when the working tree has uncommitted changes (agents will not see them). engines.node >=22, doctor requires Node 22, Dockerfile node:22-slim; CI matrix was already 22/24. Dependencies updated within their current majors (lockfile), 0 vulnerabilities; major upgrades deferred to task-31. E2E: default worktree run leaves the working directory untouched; non-git fallback; dirty-tree warning.
<!-- SECTION:FINAL_SUMMARY:END -->
