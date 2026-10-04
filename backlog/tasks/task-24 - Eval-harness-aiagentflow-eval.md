---
id: TASK-24
title: 'Eval harness: aiagentflow eval'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 06:27'
labels:
  - testing
  - quality
milestone: m-2
dependencies:
  - TASK-9
priority: medium
type: feature
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fixture repos + tasks with hidden tests. Report pass rate, cost, wall time, iterations per workflow/model. CI job to catch regressions and publish numbers in README.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 At least 10 fixture tasks across 2 languages
- [x] #2 JSON + table report
- [ ] #3 Baseline numbers for v1.4 vs v2 recorded
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
aiagentflow eval [suite] (src/eval/): each task's repo is copied to a temp git repo with the project's providers/agent models (headless, in place; env API keys never written to disk), the workflow runs on the prompt, then hidden tests are copied in and the task's check command decides pass/fail. Report: table or JSON (--json, --report) with pass rate, iterations, tokens, cost, time, and the models used; --task, --keep, --min-pass-rate, budget flags. Shipped suite: 10 tasks (5 JavaScript with node --test, 5 Python with unittest, no installs), each with a reference solution; a unit test proves every task's hidden tests fail on the starting repo and pass on the solution. evals/ ships in the npm package. Manual CI job .github/workflows/evals.yml (provider/workflow/budget inputs, job summary, JSON artifact). Docs: docs/evals.md. AC3 (baseline numbers v1.4 vs v2) NOT done: needs real API keys, and v1.4 cannot run this harness; run the Evals workflow once a key secret exists and record the numbers.
<!-- SECTION:FINAL_SUMMARY:END -->
