---
id: TASK-10
title: Repo map context instead of bulk source injection
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 02:19'
labels:
  - runtime
  - context
milestone: m-0
dependencies:
  - TASK-7
priority: medium
type: feature
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
loadSourceFiles dumps source into prompts. Replace with a compact repo map (tree + exported symbols per file, token-budgeted); agents pull details with read_file/grep.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Repo map respects .gitignore and a token budget
- [x] #2 Code agents no longer receive full source by default
- [x] #3 Prompt tokens on fixture repo drop measurably
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New src/core/workflow/repo-map.ts: buildRepoMap(root, { maxTokens }) lists git-visible files grouped by directory (root first) with exported/top-level symbols from per-language regexes (TS/JS, Python, Go, Rust, Java, Kotlin, C#, Ruby, PHP). Over budget it halves the largest symbol lists first, then cuts the file list with a pointer to list_dir. The runner rebuilds the map per step (files change) and gives it to every agent; full sources are only loaded and inlined in legacyFileBlocks mode. New project.repoMapTokens (default 4000, 0 disables). Measured: on this repo the map is ~11.5k chars vs 73k for the (capped) inlined sources; fixture test asserts < 1/5. Dry run reports the map setting.
<!-- SECTION:FINAL_SUMMARY:END -->
