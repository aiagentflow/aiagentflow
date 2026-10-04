---
id: TASK-11
title: 'Structured verdicts for Reviewer, Security, Judge'
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
labels:
  - agents
milestone: m-0
dependencies:
  - TASK-3
priority: high
type: feature
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reviewer approval is currently includes('APPROVE') && !includes('REJECT'). Use JSON output validated with Zod: {verdict, issues[{severity,file,line,message}], summary}. Use native structured output / tool-forced JSON where available, repair-retry otherwise.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Zod schemas for review, security, judge verdicts
- [ ] #2 Runner branches on parsed verdict, never on substrings
- [ ] #3 Invalid JSON triggers one repair retry, then fails clearly
- [ ] #4 Export command includes structured issues
<!-- AC:END -->
