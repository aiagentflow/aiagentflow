---
id: TASK-8
title: run_command tool and permission model
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 02:11'
labels:
  - runtime
  - security
milestone: m-0
dependencies:
  - TASK-6
priority: high
type: feature
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Let agents run tests/linters/builds. Permissions in config: allow/deny command patterns, per-role tool allowlists, mode ask|auto|deny. Timeouts and output truncation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Commands matching deny list never run
- [x] #2 ask mode prompts in interactive runs, denies in headless
- [x] #3 Per-role allowlist (e.g. reviewer read-only)
- [x] #4 Timeout + truncated output returned to the model
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New permissions config (mode ask|auto|deny, allow/deny command patterns with * wildcards, per-role built-in tool allowlists, commandTimeoutMs). src/tools/permissions.ts: deny rules checked on the whole command and each &&/||/;/| segment (even in auto mode); allow requires every segment to match and never covers $(...)/backticks. DEFAULT_DENY blocks sudo, pushes, publishing, hard resets, curl/wget/ssh, destructive rm. src/tools/command.ts: run_command runs in its own process group with a timeout that kills the whole tree, kills children on SIGINT/SIGTERM/exit, truncates output (head+tail), returns exit code; ask mode uses an injected confirm (once/always/no) and denies when non-interactive. src/tools/builtin.ts: createBuiltinTools(role) with read-only defaults for architect/reviewer/security/judge and commandPolicyFromConfig (auto-allows test/lint/format commands). cli/utils/confirm-command.ts prompt. Wired into agents in task-9.
<!-- SECTION:FINAL_SUMMARY:END -->
