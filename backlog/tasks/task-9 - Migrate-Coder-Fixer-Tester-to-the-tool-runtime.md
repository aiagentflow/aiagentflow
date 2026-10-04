---
id: TASK-9
title: 'Migrate Coder, Fixer, Tester to the tool runtime'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 02:15'
labels:
  - agents
  - breaking
milestone: m-0
dependencies:
  - TASK-7
  - TASK-8
  - TASK-1
priority: high
type: feature
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace FILE: block output with tool-driven edits (see decision-1). Update prompts in src/prompts/library.ts. Keep file-parser.ts behind a legacyFileBlocks flag for models without tool support.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Code agents edit via tools; no FILE: parsing on the default path
- [x] #2 Legacy flag restores old behaviour
- [x] #3 E2E runner tests pass with MockProvider
- [ ] #4 Manual run on a real repo with Anthropic and OpenAI
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Coder/Tester/Fixer default prompts now explore with list_dir/grep/read_file, edit with edit_file/write_file, verify with run_command, and reply with a summary instead of file contents. Architect/Reviewer/Security/Judge prompts tell them to read the changed files (they previously only saw the file list). Every agent gets its role's built-in tools from the factory (bound to the worktree when isolated). The runner gives each step a ChangeSet and records tool-edited files; if a model ignores tools and emits FILE: blocks they are still written, with a warning. workflow.legacyFileBlocks=true restores v1 (no built-in tools, FILE: prompts). Untouched v1 prompt files in .aiagentflow/prompts are upgraded transparently; customised ones that still mention FILE: trigger a one-time warning. Interactive runs prompt for unlisted commands (spinner paused); --auto runs deny them. file-parser writes now go through resolveInside (symlink-safe). AC4 (manual run with real Anthropic/OpenAI keys) not done: no keys in this environment.
<!-- SECTION:FINAL_SUMMARY:END -->
