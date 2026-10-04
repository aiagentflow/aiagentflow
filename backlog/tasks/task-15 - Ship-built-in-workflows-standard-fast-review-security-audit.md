---
id: TASK-15
title: 'Ship built-in workflows: standard, fast, review, security-audit'
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
labels:
  - workflow
milestone: m-1
dependencies:
  - TASK-14
priority: medium
type: feature
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
fast = coder+tester; review = reviewer+security on a diff (no edits); security-audit = security on whole repo. Replaces --mode presets partially.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 aiagentflow run --workflow <name>
- [ ] #2 Each built-in has an E2E test
- [ ] #3 --mode maps to workflows or is deprecated with a warning
<!-- AC:END -->
