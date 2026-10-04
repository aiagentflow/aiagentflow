---
id: TASK-19
title: Official GitHub Action
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 03:13'
labels:
  - ci
milestone: m-1
dependencies:
  - TASK-17
  - TASK-18
priority: medium
type: feature
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
aiagentflow/action: run review on pull_request, or run --issue on label. Inputs: workflow, provider keys, max-cost, fail-on.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Action repo or ./action in this repo with action.yml
- [x] #2 Example workflows in README
- [ ] #3 Dogfooded on this repo's PRs
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Composite action in action/ (action.yml, write-config.mjs, README with PR-review and issue-label examples). Inputs: command review|run, task, workflow, fail-on, comment, provider, model, max-cost, max-time, cli-version (latest or local), working-directory; outputs report/events paths. Review mode: PR events use review --pr --comment, push events review before..HEAD; report appended to the job summary; exit code passes through. Run mode: headless with NDJSON event log. Inputs reach bash only via env (no script injection); bash blocks syntax-checked and the Review step simulated with a stub CLI. Supporting changes: provider API keys can come from env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, GEMINI_API_KEY/GOOGLE_API_KEY, OPENROUTER_API_KEY), so config.json can be committed without secrets; aiagentflow config now masks API keys and token-like MCP env values (it printed them in plain text before); review --report <file>. Dogfood workflow .github/workflows/aiagentflow-review.yml builds the CLI from the PR and runs ./action, but skips with a notice until an ANTHROPIC_API_KEY repo secret is added (none exists today), so AC3 is pending that secret.
<!-- SECTION:FINAL_SUMMARY:END -->
