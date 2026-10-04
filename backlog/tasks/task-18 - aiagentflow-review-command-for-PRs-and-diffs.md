---
id: TASK-18
title: aiagentflow review command for PRs and diffs
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 03:07'
labels:
  - ci
  - workflow
milestone: m-1
dependencies:
  - TASK-15
  - TASK-17
priority: high
type: feature
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
aiagentflow review [--pr N | --diff ref..ref | --staged] runs the review workflow on a diff. Optionally posts inline PR comments via gh. Fails with exit 1 on blocking issues.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Works on staged changes, a ref range, and a PR
- [x] #2 --comment posts inline review comments
- [x] #3 Severity threshold configurable (--fail-on high)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
aiagentflow review [--staged | --diff <range> | --pr <n>] (default: uncommitted changes vs HEAD). Diff sources and a unified-diff parser (changed files, commentable new-side lines; header detection robust to added lines starting with ++) in src/integrations/diff.ts. Runs a gate-free reviewer + security workflow (both always run) with the diff as a reference document and the changed files as Modified Files, headless and in place; --workflow can substitute another. src/core/review.ts collects findings by severity, applies --fail-on (critical|high|medium|low|nit|never, default high; exit 1 when blocking), formats a markdown report, and splits findings into inline comments vs body. --comment posts a COMMENT review via gh api with commit_id (postPRReview in github.ts). RunOptions gained definition, contextDocuments, initialContext. Budget flags shared with run via cli/utils/run-options.ts. Also removed em-dashes from v2 comments and CLI copy (user style rule). Docs: docs/review.md. Not run against a live PR or LLM.
<!-- SECTION:FINAL_SUMMARY:END -->
