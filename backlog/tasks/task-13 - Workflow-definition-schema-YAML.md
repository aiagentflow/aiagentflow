---
id: TASK-13
title: Workflow definition schema (YAML)
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 02:35'
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
- [x] #1 Schema + loader with clear validation errors
- [x] #2 Built-in 'standard' workflow reproduces today's 7-agent pipeline
- [x] #3 aiagentflow workflow list / validate commands
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New src/core/workflow/definition.ts: Zod schema for workflows (steps with id, agent, trigger always|on-fail, checks format|lint|test, gate verdict, onFail, next, approval, maxTurns), cross-step validation (unique ids, known targets, onFail required for failable steps, verdict gates only on judging agents, at least one always step), parseWorkflow with path-annotated errors, routing helpers. Built-in 'standard' workflow as YAML (builtin-workflows.ts); test proves its agent order and fix routes match the v1 STATE_AGENT_MAP. One intentional difference: judge failure routes to the fixer (v1 re-ran review without fixing). Loader: .aiagentflow/workflows/*.yml|yaml, project files override built-ins, file name must match name, broken files reported without hiding others. CLI: aiagentflow workflow list | show <name> | validate [files]. Adds the yaml dependency (zero deps). Executor is task-14.
<!-- SECTION:FINAL_SUMMARY:END -->
