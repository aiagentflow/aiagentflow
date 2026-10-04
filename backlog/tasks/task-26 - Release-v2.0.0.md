---
id: TASK-26
title: Release v2.0.0
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 12:08'
labels:
  - release
milestone: m-2
dependencies:
  - TASK-19
  - TASK-22
  - TASK-23
  - TASK-24
  - TASK-25
priority: high
type: chore
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cut 2.0.0 via the release workflow after beta feedback. Update CLI version in src/cli/index.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All GA tasks done; typecheck, lint, tests green
- [ ] #2 Published to npm latest
- [ ] #3 GitHub release notes link MIGRATION.md
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-04: published 2.0.0-beta.0 to npm with dist-tag next (latest stays 1.4.0); GitHub prerelease v2.0.0-beta.0. Smoke-tested a clean npm install (version, workflows, bundled evals). Remaining for GA: real-model smoke test by the user (npm i -g @aiagentflow/cli@next), then release.yml bump=major (2.0.0, moves the v2 tag for the Action), then the update-website skill and the eval baseline (task-24 AC3).
<!-- SECTION:NOTES:END -->
