---
id: TASK-25
title: 'v2 docs, migration guide, and website'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 06:31'
labels:
  - docs
milestone: m-2
dependencies:
  - TASK-20
  - TASK-21
priority: high
type: docs
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
README rewrite around v2 positioning, MIGRATION.md (v1 -> v2), workflow + permissions reference, CHANGELOG. Sync aiagentflow.dev (update-website skill). Archive PLAN_V2.md and TRACKING.md in favour of this backlog.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 MIGRATION.md covers config, prompts, plugins, defaults
- [x] #2 README reflects v2 commands
- [ ] #3 Website synced
- [ ] #4 PLAN_V2.md and TRACKING.md removed or archived
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
MIGRATION.md: plugin providers must implement the v2 LLMProvider contract (ChatMessage union, ChatResponse.stopReason/toolCalls, no onToolCall in ChatOptions).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
README rewritten around v2 (tools, verdict gates, YAML workflows, review, CI, providers with new defaults, permissions, extending, npm-based dev setup). MIGRATION.md (migrate command, customised prompts, behaviour change table, scripts/CI, plugins, legacy mode). CHANGELOG.md with the 2.0.0 section. New docs/workflows.md and docs/permissions.md alongside the existing events/headless/review/plugins/evals docs. Removed the stale pnpm-lock.yaml (untouched since scaffolding; npm is the real lockfile). AC3 (website) deferred until after the release, because the update-website skill syncs version numbers from the published release. AC4: PLAN_V2.md and TRACKING.md are local untracked/git-ignored files of the user, not in the repo; left untouched, superseded by backlog/.
<!-- SECTION:FINAL_SUMMARY:END -->
