---
id: TASK-11
title: 'Structured verdicts for Reviewer, Security, Judge'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 01:19'
updated_date: '2026-10-04 02:25'
labels:
  - agents
milestone: m-0
dependencies:
  - TASK-3
priority: high
type: feature
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reviewer approval is currently includes('APPROVE') && !includes('REJECT'). Use JSON output validated with Zod: {verdict, issues[{severity,file,line,message}], summary}. Use native structured output / tool-forced JSON where available, repair-retry otherwise.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Zod schemas for review, security, judge verdicts
- [x] #2 Runner branches on parsed verdict, never on substrings
- [x] #3 Invalid JSON triggers one repair retry, then fails clearly
- [x] #4 Export command includes structured issues
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New src/agents/verdicts.ts (Zod schemas for review/security/judge verdicts with typed issues: severity, message, file, line, suggestion) and VerdictAgent base: Reviewer/Security/Judge must call submit_verdict; invalid input returns a schema error to the model; the loop stops as soon as a valid verdict is submitted (BaseAgent.isDone); if the agent ends without one it gets one reminder (BaseAgent.completionReminder), then a JSON-in-text fallback, then a WorkflowError that aborts the run. Runner branches only on the parsed verdict; feedback passed to the fixer is the formatted verdict; verdicts stored in WorkflowContext.verdicts and exported (JSON verdicts field, markdown QA Verdict). Removed substring helpers (ReviewerAgent.isApproved, JudgeAgent.isPassed) and the text-parsing evaluateReview. Prompts updated; untouched v1 prompt files for all roles now upgrade transparently (V1_PROMPTS exported for task-20 migrate).
<!-- SECTION:FINAL_SUMMARY:END -->
