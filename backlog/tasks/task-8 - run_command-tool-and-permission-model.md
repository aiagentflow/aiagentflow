---
id: TASK-8
title: run_command tool and permission model
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
labels:
  - runtime
  - security
milestone: m-0
dependencies:
  - TASK-6
priority: high
type: feature
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Let agents run tests/linters/builds. Permissions in config: allow/deny command patterns, per-role tool allowlists, mode ask|auto|deny. Timeouts and output truncation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Commands matching deny list never run
- [ ] #2 ask mode prompts in interactive runs, denies in headless
- [ ] #3 Per-role allowlist (e.g. reviewer read-only)
- [ ] #4 Timeout + truncated output returned to the model
<!-- AC:END -->
