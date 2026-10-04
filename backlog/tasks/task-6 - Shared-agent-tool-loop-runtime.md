---
id: TASK-6
title: Shared agent tool-loop runtime
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
labels:
  - runtime
  - agents
milestone: m-0
dependencies:
  - TASK-3
priority: high
type: feature
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
One loop in BaseAgent (or src/agents/runtime.ts) that calls the provider, executes tools, appends results, and stops on final answer, max turns, or budget. Works for execute and executeStreaming (streaming currently drops tools).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Single loop used by all providers
- [ ] #2 Configurable maxTurns per role
- [ ] #3 Streaming path supports tools
- [ ] #4 MCP and memory tools routed through the same registry
<!-- AC:END -->
