---
id: TASK-13
title: Workflow definition schema (YAML)
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
labels:
  - workflow
  - breaking
milestone: m-1
dependencies: []
priority: high
type: feature
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Define pipelines in .aiagentflow/workflows/*.yml: steps (agent, tools, model), gates (verdict/test/lint), loops (on fail -> step, max iterations), approvals. Zod-validated.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Schema + loader with clear validation errors
- [ ] #2 Built-in 'standard' workflow reproduces today's 7-agent pipeline
- [ ] #3 aiagentflow workflow list / validate commands
<!-- AC:END -->
