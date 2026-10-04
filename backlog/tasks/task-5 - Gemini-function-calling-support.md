---
id: TASK-5
title: Gemini function-calling support
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 02:00'
labels:
  - providers
milestone: m-0
dependencies:
  - TASK-3
priority: medium
type: feature
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Map ToolDefinition to Gemini functionDeclarations and functionCall/functionResponse parts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Gemini returns tool calls via the new contract
- [x] #2 Streaming with tools works
- [x] #3 Unit tests with recorded fixtures
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gemini adapter sends functionDeclarations (schemas cleaned of keywords Gemini rejects: $schema, $id, additionalProperties, default, examples), returns functionCall parts as toolCalls (stopReason tool_use, since Gemini reports STOP), and maps tool turns to functionCall/functionResponse parts (responses matched by function name). Thought signatures round-trip through the new optional ToolCall.metadata. Streaming yields function calls. With all six providers on native tools, the unused toPlainMessages helper was removed. Tests use recorded-style JSON/SSE fixtures; not run against the live API.
<!-- SECTION:FINAL_SUMMARY:END -->
