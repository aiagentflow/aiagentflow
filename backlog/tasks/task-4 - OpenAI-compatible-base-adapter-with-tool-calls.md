---
id: TASK-4
title: OpenAI-compatible base adapter with tool calls
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
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
- [ ] #1 Shared base implements chat/stream with tools
- [ ] #2 openai, groq, openrouter, ollama extend it
- [ ] #3 Provider tests pass; net LOC reduced
<!-- AC:END -->
