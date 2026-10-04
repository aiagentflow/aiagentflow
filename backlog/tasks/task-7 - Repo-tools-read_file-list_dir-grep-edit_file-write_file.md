---
id: TASK-7
title: 'Repo tools: read_file, list_dir, grep, edit_file, write_file'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 02:06'
labels:
  - runtime
milestone: m-0
dependencies:
  - TASK-6
priority: high
type: feature
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Built-in tools scoped to the effective project root (worktree aware). edit_file uses exact search/replace with uniqueness check; write_file only for new files.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Paths outside project root are rejected
- [x] #2 edit_file fails clearly on 0 or >1 matches
- [x] #3 read_file supports offset/limit for large files
- [x] #4 Changed files are tracked for the workflow context
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New src/tools/repo.ts: createRepoTools({ root, changes?, readOnly? }) returns read_file (numbered lines, offset/limit, size cap), list_dir (direct or recursive, git-ignore aware via git ls-files, fs walk fallback skipping .git/node_modules), grep (regex, path/glob filters, result cap, skips binary/large files), edit_file (exact search/replace; errors on 0 or >1 matches unless replace_all), write_file (new files only). resolveInside() rejects paths that escape the root, including through symlinks. A ChangeSet records files written by edit/write; the runner consumes it in task-9 when code agents switch to tools. Not wired into any agent yet (task-9). 27 tests.
<!-- SECTION:FINAL_SUMMARY:END -->
