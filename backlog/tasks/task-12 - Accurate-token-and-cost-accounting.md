---
id: TASK-12
title: Accurate token and cost accounting
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 02:30'
labels:
  - runtime
milestone: m-0
dependencies:
  - TASK-6
priority: medium
type: enhancement
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Streaming estimates tokens as chars/4. Read real usage (incl. cache read/write tokens) from every provider, across all tool-loop turns.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No chars/4 estimate when the provider reports usage
- [x] #2 Cache tokens tracked and priced
- [x] #3 Run summary totals match provider-reported usage
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TokenUsage gains cacheReadTokens/cacheWriteTokens (subsets of promptTokens, which now always counts all input). ChatChunk.usage carries stream totals. Anthropic: input incl. cache read/creation, stream usage from message_start + message_delta. OpenAI-compatible: stream_options.include_usage, final usage chunk, Groq x_groq.usage, prompt_tokens_details.cached_tokens. Gemini: cumulative usageMetadata, thinking tokens counted as output, cachedContentTokenCount. Agents sum usage over all tool-loop turns (AgentOutput.usage); chars/4 only when a stream reports nothing. Runner records real usage (was promptTokens 0). Tracker: ModelPricing with cache rates (Anthropic 0.1x read / 1.25x write; others default to input price), single costOf() used by tracker and runs command (removed its duplicate price table), summary shows cache-read share.
<!-- SECTION:FINAL_SUMMARY:END -->
