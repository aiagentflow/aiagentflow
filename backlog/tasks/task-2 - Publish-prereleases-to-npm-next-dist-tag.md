---
id: TASK-2
title: Publish prereleases to npm 'next' dist-tag
status: Done
assignee: []
created_date: '2026-10-04 01:18'
updated_date: '2026-10-04 01:49'
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
- [x] #1 Release workflow accepts prerelease bump (premajor/prerelease)
- [x] #2 Prereleases publish with --tag next
- [x] #3 npm i @aiagentflow/cli@next installs the alpha
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
release.yml accepts prepatch/preminor/premajor/prerelease with a preid input (alpha/beta/rc) and now runs lint. tag-on-merge.yml marks versions containing '-' as GitHub prereleases. publish.yml publishes those with --tag next (stable stays on latest) and now honours the workflow_dispatch ref input (checkout previously ignored it). do-release command documents the new options. AC3 (npm i @aiagentflow/cli@next) is verified when the first alpha is cut.
<!-- SECTION:FINAL_SUMMARY:END -->
