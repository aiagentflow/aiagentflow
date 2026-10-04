---
id: TASK-17
title: 'Headless mode, exit codes, and budget cap'
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
labels:
  - ci
milestone: m-1
dependencies:
  - TASK-16
priority: high
type: feature
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
--headless: no prompts ever, ask-permissions resolve to deny. Stable exit codes (0 pass, 1 gate failed, 2 config error, 3 budget exceeded, 4 provider error). --max-cost USD and --max-time.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No interactive prompt reachable in headless mode
- [ ] #2 Exit codes documented and tested
- [ ] #3 Run aborts cleanly with partial report when budget exceeded
<!-- AC:END -->
