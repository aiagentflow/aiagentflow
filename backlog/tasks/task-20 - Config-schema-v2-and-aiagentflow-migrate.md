---
id: TASK-20
title: Config schema v2 and aiagentflow migrate
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
labels:
  - breaking
  - dx
milestone: m-2
dependencies:
  - TASK-14
  - TASK-8
priority: high
type: feature
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
New config shape: workflows, permissions, agents.*.tools/maxTurns, configVersion: 2. migrate converts v1 configs and custom prompts, with backup. v1 config detected on load -> clear message.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 configVersion field; v1 detected with actionable error
- [ ] #2 migrate writes backup and v2 config
- [ ] #3 Migration tests on real v1.x fixtures
<!-- AC:END -->
