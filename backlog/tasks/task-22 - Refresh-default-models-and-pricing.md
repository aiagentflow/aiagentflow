---
id: TASK-22
title: Refresh default models and pricing
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 06:17'
labels:
  - providers
milestone: m-2
dependencies: []
priority: medium
type: chore
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Defaults are stale (claude-sonnet-4-20250514, gpt-4o-mini, gemini-2.0-flash). Update defaults and pricing; decide between bundled table and models.dev fetch with cache (open question from PLAN_V2).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Defaults updated for all 6 providers
- [x] #2 Pricing source decided and implemented
- [x] #3 doctor warns on deprecated models
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Defaults (single source: providers/metadata.ts, adapters read it): anthropic claude-opus-5-5, openai gpt-5-mini, gemini gemini-2.5-flash, groq llama-3.3-70b-versatile (still production), ollama llama3.2:latest, openrouter qwen/qwen3.8-27b:free (old free default no longer exists). Verified against the claude-api skill model table, OpenAI and Gemini official pricing docs, Groq models doc, and OpenRouter's live model API. Compatibility fixes needed for current models: Anthropic adapter omits temperature for models that reject sampling params (Opus 4.7+, Sonnet 5+, Fable, Mythos); OpenAI adapter sends max_completion_tokens and omits temperature for reasoning models (o-series, gpt-5+). Default agent maxTokens 16000 (thinking/reasoning models spend output tokens first). Pricing decision: bundled table, refreshed per release, works offline; per-model cache-read prices; OpenRouter :free models cost 0; unknown models show no cost. Anthropic listModels/validateConnection now use the Models API. doctor gained a Models section: warns when a reachable provider doesn't list an agent's model (retired/misspelled; Ollama: suggests ollama pull) and when a model has no pricing data. Groq prices kept as approximate; no Groq pricing page could be fetched.
<!-- SECTION:FINAL_SUMMARY:END -->
