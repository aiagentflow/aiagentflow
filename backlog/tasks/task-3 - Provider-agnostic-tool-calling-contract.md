---
id: TASK-3
title: Provider-agnostic tool-calling contract
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:18'
updated_date: '2026-10-04 01:54'
labels:
  - providers
  - runtime
  - breaking
milestone: m-0
dependencies: []
priority: high
type: feature
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today ChatMessage is text only and the Anthropic adapter runs its own tool loop via onToolCall. Change the contract so providers return tool calls and accept tool results as messages; the loop moves out of providers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ChatMessage supports assistant tool_calls and tool_result content
- [x] #2 ChatResponse exposes toolCalls and stopReason
- [x] #3 stream() yields tool-call chunks
- [x] #4 Anthropic adapter migrated; onToolCall removed from ChatOptions
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
ChatMessage is now a union (TextMessage | AssistantMessage with toolCalls | ToolResultMessage). ChatResponse adds normalized stopReason and toolCalls; ChatChunk can carry toolCalls and stopReason. onToolCall removed from ChatOptions: providers return calls, never execute them. Anthropic adapter does one request per chat(), serializes tool_use/tool_result blocks, and assembles streamed tool calls from input_json_delta. The tool loop moved to BaseAgent.execute (MAX_TOOL_TURNS=10, final call without tools). Other adapters flatten tool turns to text via providers/messages.ts until tasks 4/5. Tests: anthropic adapter (mocked fetch), messages helpers, agent tool loop.
<!-- SECTION:FINAL_SUMMARY:END -->
