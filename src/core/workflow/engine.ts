/**
 * Workflow engine placeholder (Phase 2).
 *
 * This will contain the core state machine that orchestrates
 * the agent workflow loop: Spec → Code → Review → Test → Fix → QA → PR
 */

export const WorkflowState = {
    Idle: 'idle',
    SpecCreated: 'spec_created',
    PlanApproved: 'plan_approved',
    CodeGenerated: 'code_generated',
    ReviewDone: 'review_done',
    TestsWritten: 'tests_written',
    TestsPassed: 'tests_passed',
    QAApproved: 'qa_approved',
    Complete: 'complete',
    Failed: 'failed',
} as const;

export type WorkflowState = (typeof WorkflowState)[keyof typeof WorkflowState];
