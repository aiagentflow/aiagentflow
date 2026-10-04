---
id: TASK-25
title: 'v2 docs, migration guide, and website'
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 01:54'
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
- [ ] #1 MIGRATION.md covers config, prompts, plugins, defaults
- [ ] #2 README reflects v2 commands
- [ ] #3 Website synced
- [ ] #4 PLAN_V2.md and TRACKING.md removed or archived
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
MIGRATION.md: plugin providers must implement the v2 LLMProvider contract (ChatMessage union, ChatResponse.stopReason/toolCalls, no onToolCall in ChatOptions).
<!-- SECTION:NOTES:END -->
