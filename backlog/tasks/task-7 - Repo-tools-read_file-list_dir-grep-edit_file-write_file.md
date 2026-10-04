---
id: TASK-7
title: 'Repo tools: read_file, list_dir, grep, edit_file, write_file'
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
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
- [ ] #1 Paths outside project root are rejected
- [ ] #2 edit_file fails clearly on 0 or >1 matches
- [ ] #3 read_file supports offset/limit for large files
- [ ] #4 Changed files are tracked for the workflow context
<!-- AC:END -->
