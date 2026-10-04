---
id: TASK-21
title: 'Plugin API v2: steps, tools, providers'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 03:25'
labels:
  - plugins
  - breaking
milestone: m-2
dependencies:
  - TASK-14
  - TASK-6
priority: medium
type: feature
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Plugins contribute workflow steps, tools, and providers instead of 'after: <agent>' anchors. Versioned manifest (apiVersion: 2).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Plugin can register a tool usable by agents
- [x] #2 Plugin step usable in a workflow YAML
- [x] #3 v1 plugins rejected with migration hint
- [x] #4 Example plugin updated
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Plugin API v2 (apiVersion 2): plugins export tools (optionally per role), providers (full LLMProvider contract, selectable via agents.<role>.provider, configured by providers.<name>), and workflow steps (uses: <plugin>/<step>, with: options; passed:false routes to onFail with the summary for the fixer). v1 plugins rejected with a migration hint. Found that v1 plugin agents/providers were never wired into runs; v2 contributions are: runner loads plugins before creating a worktree or session and fails early (exit 2) on unknown plugin steps; executor runs plugin steps; factory gets plugin tools; provider registry accepts external providers; chat/plan load plugins. Config agent provider is now any string; providers allows extra keys. Example: examples/plugin-no-todos; docs: docs/plugins.md.
<!-- SECTION:FINAL_SUMMARY:END -->
