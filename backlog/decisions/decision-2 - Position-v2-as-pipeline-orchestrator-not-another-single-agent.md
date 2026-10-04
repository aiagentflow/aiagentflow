---
id: decision-2
title: 'Position v2 as pipeline orchestrator, not another single agent'
date: '2026-10-04 01:16'
status: proposed
---
## Context

By Oct 2026 the single-agent CLI space is crowded (OpenCode, Codex CLI, Claude Code, Pi, Cline CLI 2.0, Aider). Editors integrate agents via ACP. aiagentflow cannot win on raw single-agent quality.

## Decision

v2 positions aiagentflow as a quality-gated pipeline: specialized roles, verified gates (review, security, tests, judge), memory, headless CI. Any step may delegate to an external agent CLI; aiagentflow owns orchestration, gates, and audit trail.

## Consequences

+ Clear differentiation; complements rather than competes with popular agents.
+ Drives priorities: structured verdicts, workflows, CI, external agents.
- Requires stable adapters for third-party CLIs whose interfaces change.

