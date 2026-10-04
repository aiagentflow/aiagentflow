---
id: TASK-9
title: 'Migrate Coder, Fixer, Tester to the tool runtime'
status: To Do
assignee: []
created_date: '2026-10-04 01:19'
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
- [ ] #1 Code agents edit via tools; no FILE: parsing on the default path
- [ ] #2 Legacy flag restores old behaviour
- [ ] #3 E2E runner tests pass with MockProvider
- [ ] #4 Manual run on a real repo with Anthropic and OpenAI
<!-- AC:END -->
