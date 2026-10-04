---
id: TASK-18
title: aiagentflow review command for PRs and diffs
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
labels:
  - ci
  - workflow
milestone: m-1
dependencies:
  - TASK-15
  - TASK-17
priority: high
type: feature
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
aiagentflow review [--pr N | --diff ref..ref | --staged] runs the review workflow on a diff. Optionally posts inline PR comments via gh. Fails with exit 1 on blocking issues.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Works on staged changes, a ref range, and a PR
- [ ] #2 --comment posts inline review comments
- [ ] #3 Severity threshold configurable (--fail-on high)
<!-- AC:END -->
