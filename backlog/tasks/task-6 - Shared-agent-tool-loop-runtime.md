---
id: TASK-6
title: Shared agent tool-loop runtime
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 02:04'
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
- [x] #1 Single loop used by all providers
- [x] #2 Configurable maxTurns per role
- [x] #3 Streaming path supports tools
- [x] #4 MCP and memory tools routed through the same registry
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
task-3 landed a basic non-streaming loop in BaseAgent.runToolLoop (MAX_TOOL_TURNS=10). This task extends it: streaming with tools, per-role maxTurns, budget stop, shared tool registry.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New src/tools/registry.ts: ToolRegistry + Tool interface; unknown tools and thrown errors become error results. BaseAgent now has one runLoop used by both execute() and executeStreaming(): streaming passes tools, accumulates streamed tool calls, reports them via StreamCallbacks.onToolCall (renderer shows [tool] markers). Per-role maxTurns via agents.<role>.maxTurns in config (default 10). The factory builds each agent's registry from extra tools (MCP via McpRegistry.toolsFor(role)) plus createRememberTool for eligible roles. Removed the no-op Reviewer.parseResponse; parseResponse now takes the final text. Budget-based stop deferred to task-17. Tests: registry, tool loop (execute + streaming, maxTurns, unknown tool), factory wiring (remember writes memory, maxTurns from config).
<!-- SECTION:FINAL_SUMMARY:END -->
