---
id: TASK-4
title: OpenAI-compatible base adapter with tool calls
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 01:57'
labels:
  - providers
  - refactor
milestone: m-0
dependencies:
  - TASK-3
priority: high
type: enhancement
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
openai, groq, openrouter and ollama all speak chat-completions. Consolidate into one base class with function calling + streaming tool deltas; each provider keeps only its base URL, auth and model listing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Shared base implements chat/stream with tools
- [x] #2 openai, groq, openrouter, ollama extend it
- [x] #3 Provider tests pass; net LOC reduced
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New src/providers/openai-compatible.ts: OpenAICompatibleProvider base with chat, streaming, function calling (tools serialization, tool_calls parsing, streamed tool-call fragment assembly), model listing and health check. openai, groq, openrouter, ollama are now thin subclasses (settings: base URL, headers, default model, max-tokens field; Groq keeps its compound-model warning via beforeRequest). Ollama moved to its /v1 OpenAI-compatible endpoint; /api/tags still used for listing/health. OpenAI base URL now tolerates a trailing /v1. Streaming ends only on [DONE] for all four (previously Groq only). src/providers net ~480 LOC smaller. Tested with mocked fetch only; no live API run (no keys/Ollama in this environment).
<!-- SECTION:FINAL_SUMMARY:END -->
