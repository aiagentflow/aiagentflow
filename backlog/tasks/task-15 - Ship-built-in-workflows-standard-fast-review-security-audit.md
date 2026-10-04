---
id: TASK-15
title: 'Ship built-in workflows: standard, fast, review, security-audit'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 02:47'
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
- [x] #1 aiagentflow run --workflow <name>
- [x] #2 Each built-in has an E2E test
- [x] #3 --mode maps to workflows or is deprecated with a warning
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built-in workflows: fast (implement + test with fix loop), review (reviewer + security, read-only, fails on a negative verdict), security-audit (single security step, 30 tool turns). Schema change: a gate or check without onFail now ends the run as failed instead of being a validation error, which is what review/audit workflows need. aiagentflow run -w/--workflow <name> for single and batch runs (threaded through the task queue). --mode kept working but prints a deprecation warning (removal in v3); it does not map to the fast workflow because the presets tune iterations/approval/temperature rather than the pipeline. Each built-in has an E2E test.
<!-- SECTION:FINAL_SUMMARY:END -->
