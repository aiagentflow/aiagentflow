---
id: TASK-21
title: 'Plugin API v2: steps, tools, providers'
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
labels:
  - plugins
  - breaking
milestone: m-2
dependencies:
  - TASK-14
  - TASK-6
priority: medium
type: feature
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Plugins contribute workflow steps, tools, and providers instead of 'after: <agent>' anchors. Versioned manifest (apiVersion: 2).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Plugin can register a tool usable by agents
- [ ] #2 Plugin step usable in a workflow YAML
- [ ] #3 v1 plugins rejected with migration hint
- [ ] #4 Example plugin updated
<!-- AC:END -->
