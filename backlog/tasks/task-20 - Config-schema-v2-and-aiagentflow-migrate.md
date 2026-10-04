---
id: TASK-20
title: Config schema v2 and aiagentflow migrate
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 03:18'
labels:
  - breaking
  - dx
milestone: m-2
dependencies:
  - TASK-14
  - TASK-8
priority: high
type: feature
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
New config shape: workflows, permissions, agents.*.tools/maxTurns, configVersion: 2. migrate converts v1 configs and custom prompts, with backup. v1 config detected on load -> clear message.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 configVersion field; v1 detected with actionable error
- [x] #2 migrate writes backup and v2 config
- [x] #3 Migration tests on real v1.x fixtures
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Config format version 2 (CONFIG_VERSION in schema). Loading a v1 file (version 1 or none) throws a ConfigError telling the user to run aiagentflow migrate (exit code 2). workflow.mode is now optional and deprecated; init no longer writes it (presets still apply their values at init). New aiagentflow migrate [--dry-run] (src/core/config/migrate.ts): backs up config.json and prompts/ to .aiagentflow/backup-v1-<timestamp>/, sets version 2, drops workflow.mode, writes the new sections (legacyFileBlocks, repoMapTokens, permissions) with defaults, replaces untouched v1 prompt files with v2 defaults, and lists customised prompts that still use v1 conventions (FILE: blocks, text verdicts) without touching them. Idempotent. Tests use v1.4.0-shaped fixtures (defaults and a multi-provider config with MCP, gates, worktree) and prove everything user-set survives. The GitHub Action's generated config uses version 2. Exported defaultPrompt() from the prompt library.
<!-- SECTION:FINAL_SUMMARY:END -->
