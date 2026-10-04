---
id: TASK-28
title: 'ACP server: aiagentflow acp'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 11:50'
labels:
  - interop
milestone: m-3
dependencies:
  - TASK-16
priority: medium
type: feature
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement Agent Client Protocol (JSON-RPC over stdio) so Zed, JetBrains and other ACP editors can drive aiagentflow, render diffs and permission prompts. Replaces the VSCode extension roadmap item.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Session, prompt, streamed updates, diffs, permission requests mapped from the event bus
- [ ] #2 Verified in Zed
- [x] #3 Docs page with editor setup
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
aiagentflow acp: ACP v1 server (src/acp/server.ts) over line-delimited JSON-RPC on stdio. Field names and enums taken from the raw v1 schema in agentclientprotocol/agent-client-protocol (schema 1.24.1; v2 is alpha). Implements initialize, authenticate, session/new, session/prompt, session/cancel. A prompt turn runs a workflow in place: plan updates per step, tool_call/tool_call_update with ACP kinds and file locations, diffs for edit_file/write_file, verdicts and check results as agent messages; run_command approvals go to the editor as session/request_permission (allow_once/allow_always/reject_once); cancel stops before the next step (new RunOptions.signal). New RunOptions.confirmCommand lets callers handle approvals. stdout carries protocol only. Tests: protocol errors, a full prompt turn driven like an editor (permission round trip, diffs, plan, verdict), cancellation, and a real acp process over stdio. Docs: docs/acp.md with Zed agent_servers setup (format checked against Zed's docs). AC2 (verified in Zed) NOT done: Zed is not installed here.
<!-- SECTION:FINAL_SUMMARY:END -->
