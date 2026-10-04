---
id: TASK-2
title: Publish prereleases to npm 'next' dist-tag
status: To Do
assignee: []
created_date: '2026-10-04 01:18'
labels:
  - ci
milestone: m-0
dependencies: []
priority: medium
type: chore
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ship 2.0.0-alpha.N / beta.N without affecting 'latest'. Extend release.yml/publish.yml.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Release workflow accepts prerelease bump (premajor/prerelease)
- [ ] #2 Prereleases publish with --tag next
- [ ] #3 npm i @aiagentflow/cli@next installs the alpha
<!-- AC:END -->
