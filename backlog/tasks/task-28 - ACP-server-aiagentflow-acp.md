---
id: TASK-28
title: 'ACP server: aiagentflow acp'
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
labels:
  - interop
milestone: m-3
dependencies:
  - TASK-16
priority: medium
type: feature
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement Agent Client Protocol (JSON-RPC over stdio) so Zed, JetBrains and other ACP editors can drive aiagentflow, render diffs and permission prompts. Replaces the VSCode extension roadmap item.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Session, prompt, streamed updates, diffs, permission requests mapped from the event bus
- [ ] #2 Verified in Zed
- [ ] #3 Docs page with editor setup
<!-- AC:END -->
