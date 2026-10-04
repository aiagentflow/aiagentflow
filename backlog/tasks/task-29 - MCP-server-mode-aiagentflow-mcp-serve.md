---
id: TASK-29
title: 'MCP server mode: aiagentflow mcp serve'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 11:56'
labels:
  - interop
milestone: m-3
dependencies:
  - TASK-17
priority: medium
type: feature
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose run, review, plan, memory as MCP tools so other agents (Claude Code, Cursor) can call the pipeline as a quality gate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 stdio MCP server with run/review/plan/memory tools
- [x] #2 Runs headless with budget caps
- [x] #3 Example config for Claude Code
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
aiagentflow mcp serve (src/mcp/server.ts): stdio MCP server with aiagentflow_run, aiagentflow_review, aiagentflow_plan, aiagentflow_memory. Runs are headless and capped by --max-cost (default $5; tool args can only lower it), worktree by default with an inplace option; progress notifications per finished step when the client sends a progress token; failures are tool errors (isError), bad input is a protocol error. Negotiates MCP protocol versions 2025-06-18/2025-03-26/2024-11-05. Extracted a shared line-delimited JSON-RPC endpoint (src/utils/jsonrpc.ts) and moved the ACP server onto it. review command split into reviewChanges() returning the report. Fixed a bug in the MCP client: notifications/initialized was sent with id 0 (notifications must not have an id). Tests include our own MCP client driving the real mcp serve process. Docs: docs/mcp-server.md with the claude mcp add command (syntax checked against the installed Claude Code).
<!-- SECTION:FINAL_SUMMARY:END -->
