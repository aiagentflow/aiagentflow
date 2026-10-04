---
id: TASK-3
title: Provider-agnostic tool-calling contract
status: To Do
assignee: []
created_date: '2026-10-04 01:18'
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
- [ ] #1 ChatMessage supports assistant tool_calls and tool_result content
- [ ] #2 ChatResponse exposes toolCalls and stopReason
- [ ] #3 stream() yields tool-call chunks
- [ ] #4 Anthropic adapter migrated; onToolCall removed from ChatOptions
<!-- AC:END -->
