/**
 * Workflow runner — prepares a run and hands it to the executor.
 *
 * This module:
 * 1. Loads config, the workflow definition, context documents, and MCP servers
 * 2. Creates (or restores) the run context and the worktree, if isolated
 * 3. Runs the workflow through the executor, saving the session after each step
 * 4. Auto-commits, finishes the worktree, and prints summaries
 *
 * Dependency direction: runner.ts → executor, engine, workflow-loader, git, config
 * Used by: cli/commands/run.ts, cli/commands/resume.ts, task-queue
 */

import chalk from 'chalk';
import prompts from 'prompts';
import { createWorkflowContext, isTerminal, type WorkflowContext } from './engine.js';
import { AGENT_ROLE_LABELS } from '../../agents/types.js';
import { GitClient } from '../../git/client.js';
import { createWorktree, mergeBranch, worktreeExists, type WorktreeInfo } from '../../git/worktree.js';
import { TokenTracker } from './token-tracker.js';
import { saveSession, loadSession, listSessions } from './session.js';
import { loadQAPolicy, type QAPolicy } from './qa-policy.js';
import { loadContextDocuments, loadSourceFiles, type ContextDocument } from './context-loader.js';
import { loadConfig } from '../config/manager.js';
import { McpRegistry } from '../../mcp/registry.js';
import type { AppConfig } from '../config/types.js';
import { logger } from '../../utils/logger.js';
import { WORKFLOW_PRESETS, type WorkflowMode } from '../config/defaults.js';
import { WorkflowError } from '../errors.js';
import { executeWorkflow } from './executor.js';
import { firstStep, type WorkflowDefinition } from './definition.js';
import { DEFAULT_WORKFLOW, getWorkflow } from './workflow-loader.js';

export interface RunOptions {
    /** Project root directory. */
    projectRoot: string;
    /** The task to accomplish. */
    task: string;
    /** Workflow to run (default: "standard"). */
    workflow?: string;
    /** Skip all human approval gates (autonomous mode). */
    auto?: boolean;
    /** Workflow mode override (fast, balanced, strict). Overrides config. */
    mode?: string;
    /** Explicit context file paths to load. */
    contextPaths?: string[];
    /** Stream agent output in real time (default: true, use --no-stream to disable). */
    streaming?: boolean;
    /** Preview workflow plan without executing agents. */
    dryRun?: boolean;
    /** Override isolation mode from config. */
    isolation?: 'worktree' | 'inplace';
    /** Agent roles that require plan-review approval. Overrides config.workflow.approvalGates. */
    approvalGates?: string[];
    /** Print the per-agent token/cost summary at the end (default: true). */
    showSummary?: boolean;
}

export interface ResumeOptions {
    /** Project root directory. */
    projectRoot: string;
    /** Session ID to resume. If not provided, resumes the most recent non-terminal session. */
    sessionId?: string;
    /** Skip all human approval gates (autonomous mode). */
    auto?: boolean;
    /** Workflow mode override (fast, balanced, strict). Overrides config. */
    mode?: string;
    /** Stream agent output in real time (default: true). */
    streaming?: boolean;
}

/**
 * Run a workflow for a task. Returns the final run context.
 */
export async function runWorkflow(options: RunOptions): Promise<WorkflowContext> {
    const { projectRoot, task, auto = false, mode, contextPaths, streaming = true, dryRun = false, showSummary = true } = options;
    const config = loadConfig(projectRoot);
    const isolationMode = options.isolation ?? config.workflow.isolation;
    const { definition: workflow } = getWorkflow(projectRoot, options.workflow ?? DEFAULT_WORKFLOW);

    // Merge CLI approval gates into config
    if (options.approvalGates && options.approvalGates.length > 0) {
        config.workflow.approvalGates = options.approvalGates as typeof config.workflow.approvalGates;
    }

    // Apply mode preset override from --mode flag
    if (mode) {
        applyModePreset(config, mode);
    }

    const maxIterations = workflow.maxIterations ?? config.workflow.maxIterations;
    const contextDocs = loadContextDocuments(projectRoot, contextPaths);
    const sourceDocs = loadLegacySources(projectRoot, config);

    // Dry-run: show execution plan and exit
    if (dryRun) {
        printDryRun(task, workflow, config, contextDocs, sourceDocs, auto, maxIterations);
        return createWorkflowContext(task, workflow.name, firstStep(workflow).id, maxIterations);
    }

    logger.header('AI Workflow — Running Task');
    console.log(chalk.gray(`Task: ${task}`));
    console.log(chalk.gray(`Workflow: ${workflow.name}`));
    if (mode) {
        console.log(chalk.blue(`Mode: ${mode}`));
    }
    if (auto) {
        console.log(chalk.yellow('⚡ Autonomous mode — no human approval required'));
    }
    console.log();

    // Worktree isolation: each task runs in its own git branch + directory
    let worktree: WorktreeInfo | undefined;
    let effectiveRoot = projectRoot;

    const git = new GitClient(projectRoot);
    const isRepo = await git.isRepo();

    if (isolationMode === 'worktree' && isRepo) {
        try {
            worktree = await createWorktree({
                projectRoot,
                branchPrefix: config.workflow.branchPrefix,
                task,
            });
            effectiveRoot = worktree.path;
        } catch (err) {
            logger.warn(`Worktree creation failed, falling back to inplace: ${err instanceof Error ? err.message : String(err)}`);
        }
    } else if (config.workflow.autoCreateBranch && isRepo) {
        // Legacy inplace branch creation
        const branchName = GitClient.toBranchName(config.workflow.branchPrefix, task);
        await git.createBranch(branchName);
    }

    return runLoop({
        ctx: createWorkflowContext(task, workflow.name, firstStep(workflow).id, maxIterations),
        workflow,
        projectRoot: effectiveRoot,
        sourceProjectRoot: projectRoot,
        config,
        qaPolicy: loadQAPolicy(projectRoot),
        tokenTracker: new TokenTracker(),
        contextDocs,
        sourceDocs,
        auto,
        streaming,
        worktree,
        showSummary,
    });
}

/**
 * Resume an interrupted workflow from a saved session.
 */
export async function resumeWorkflow(options: ResumeOptions): Promise<WorkflowContext> {
    const { projectRoot, auto = false, mode, streaming = true } = options;
    let { sessionId } = options;

    // If no session ID, find the most recent non-terminal session
    if (!sessionId) {
        const sessions = listSessions(projectRoot);
        const resumable = sessions.find(s => !isTerminal(s.context));
        if (!resumable) {
            throw new WorkflowError('No resumable sessions found. Run "aiagentflow sessions" to see all sessions.');
        }
        sessionId = resumable.id;
    }

    const session = loadSession(projectRoot, sessionId);
    if (!session) {
        throw new WorkflowError(`Session not found: ${sessionId}`, { sessionId });
    }

    if (isTerminal(session.context)) {
        throw new WorkflowError(
            `Session "${sessionId}" already ${session.context.status} and cannot be resumed.`,
            { sessionId, status: session.context.status },
        );
    }

    const config = loadConfig(projectRoot);
    if (mode) {
        applyModePreset(config, mode);
    }
    const { definition: workflow } = getWorkflow(projectRoot, session.context.workflow);

    const tokenTracker = new TokenTracker();
    tokenTracker.restoreEntries(session.tokenUsage);

    // Restore worktree if the session ran in one
    let effectiveRoot = projectRoot;
    let worktree: WorktreeInfo | undefined;

    if (session.worktreePath && session.worktreeBranch) {
        const exists = await worktreeExists(projectRoot, session.worktreePath);

        if (exists) {
            effectiveRoot = session.worktreePath;
            worktree = {
                path: session.worktreePath,
                branch: session.worktreeBranch,
                baseBranch: await resolveBaseBranch(projectRoot, session.worktreeBranch),
                cleanup: () => import('../../git/worktree.js').then(m =>
                    m.removeWorktree(projectRoot, session.worktreePath!, session.worktreeBranch!),
                ),
            };
            logger.info(`Restored worktree: ${session.worktreePath} (branch: ${session.worktreeBranch})`);
        } else {
            // Worktree was discarded — ask what to do
            const { action } = await prompts({
                type: 'select',
                name: 'action',
                message: `Worktree for this session no longer exists. How would you like to continue?`,
                choices: [
                    { title: 'Recreate worktree from branch', value: 'recreate' },
                    { title: 'Continue in-place (current directory)', value: 'inplace' },
                    { title: 'Abort', value: 'abort' },
                ],
            });

            if (!action || action === 'abort') {
                throw new WorkflowError('Resume aborted — worktree no longer exists.');
            }

            if (action === 'recreate') {
                try {
                    worktree = await createWorktree({
                        projectRoot,
                        branchPrefix: config.workflow.branchPrefix,
                        task: session.context.task,
                        baseRef: session.worktreeBranch,
                    });
                    effectiveRoot = worktree.path;
                    logger.info(`Recreated worktree at: ${worktree.path}`);
                } catch (err) {
                    logger.warn(`Could not recreate worktree: ${err instanceof Error ? err.message : String(err)}. Continuing in-place.`);
                }
            }
            // 'inplace' falls through with effectiveRoot = projectRoot
        }
    }

    logger.header('AI Workflow — Resuming Session');
    console.log(chalk.gray(`Session: ${sessionId}`));
    console.log(chalk.gray(`Task: ${session.context.task}`));
    console.log(chalk.gray(`Workflow: ${workflow.name}, resuming at step "${session.context.step ?? ''}"`));
    if (worktree) {
        console.log(chalk.gray(`Worktree: ${worktree.path}`));
    }
    if (mode) {
        console.log(chalk.blue(`Mode: ${mode}`));
    }
    if (auto) {
        console.log(chalk.yellow('⚡ Autonomous mode — no human approval required'));
    }
    console.log();

    return runLoop({
        ctx: session.context,
        workflow,
        sessionId,
        projectRoot: effectiveRoot,
        sourceProjectRoot: projectRoot,
        config,
        qaPolicy: loadQAPolicy(projectRoot),
        tokenTracker,
        contextDocs: loadContextDocuments(projectRoot),
        sourceDocs: loadLegacySources(projectRoot, config),
        auto,
        streaming,
        worktree,
    });
}

async function resolveBaseBranch(projectRoot: string, branch: string): Promise<string> {
    try {
        const { execa } = await import('execa');
        const { stdout } = await execa('git', ['merge-base', '--fork-point', 'HEAD', branch], { cwd: projectRoot });
        if (stdout.trim()) {
            const { stdout: name } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectRoot });
            return name.trim();
        }
    } catch { /* ignore */ }
    return 'main';
}

// ── Run loop ──

interface RunLoopParams {
    ctx: WorkflowContext;
    workflow: WorkflowDefinition;
    sessionId?: string;
    /** Effective project root — may be a worktree path. */
    projectRoot: string;
    /** The original source project root (where sessions/config live). */
    sourceProjectRoot: string;
    config: AppConfig;
    tokenTracker: TokenTracker;
    qaPolicy: QAPolicy;
    contextDocs: ContextDocument[];
    sourceDocs: ContextDocument[];
    auto: boolean;
    streaming: boolean;
    /** Worktree info if the run is isolated, undefined for inplace runs. */
    worktree?: WorktreeInfo;
    /** Print token/cost summary at end of run (default: true). */
    showSummary?: boolean;
}

/**
 * Shared by runWorkflow() and resumeWorkflow(): start MCP servers, execute
 * the workflow with session saves, then commit, finish the worktree, and
 * print summaries.
 */
async function runLoop(params: RunLoopParams): Promise<WorkflowContext> {
    const { projectRoot, sourceProjectRoot, config, tokenTracker, worktree, showSummary = true } = params;
    const startedAt = Date.now();
    const worktreeMeta = worktree ? { branch: worktree.branch, path: worktree.path } : undefined;
    let sessionId = params.sessionId;

    const mcpRegistry = new McpRegistry();
    if (Object.keys(config.mcpServers ?? {}).length > 0) {
        await mcpRegistry.start(config.mcpServers);
    }

    let ctx: WorkflowContext;
    try {
        ctx = await executeWorkflow({
            ...params,
            mcpRegistry: mcpRegistry.isActive ? mcpRegistry : undefined,
            // Save after each step (crash recovery)
            onStep: (current) => {
                sessionId = saveSession(sourceProjectRoot, current, tokenTracker.getEntries(), sessionId, worktreeMeta);
            },
        });
    } finally {
        mcpRegistry.stop();
    }

    // Auto-commit if the run passed and autoCommit is enabled
    if (config.workflow.autoCommit && ctx.status === 'passed') {
        try {
            const git = new GitClient(projectRoot);
            if (await git.isRepo()) {
                const message = (config.workflow.autoCommitMessage ?? 'ai: {task}').replace('{task}', ctx.task);
                const hash = await git.commitAll(message);
                logger.success(`Auto-committed: ${hash}`);
            }
        } catch (err) {
            logger.warn(`Auto-commit failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    if (worktree) {
        await handleWorktreeFinish(worktree, ctx, sourceProjectRoot, config, params.auto);
    }

    saveSession(sourceProjectRoot, ctx, tokenTracker.getEntries(), sessionId, worktreeMeta);

    printWorkflowSummary(ctx);
    if (showSummary) {
        tokenTracker.printSummary(Date.now() - startedAt);
    }

    return ctx;
}

// ── Worktree merge ──

/**
 * After a worktree run finishes, either auto-merge or show merge instructions.
 */
async function handleWorktreeFinish(
    worktree: WorktreeInfo,
    ctx: WorkflowContext,
    sourceProjectRoot: string,
    config: AppConfig,
    auto: boolean,
): Promise<void> {
    const passed = ctx.status === 'passed';
    const { branch, baseBranch } = worktree;

    const shouldAutoMerge =
        config.workflow.autoMerge === 'always' ||
        (config.workflow.autoMerge === 'on-judge-pass' && passed);

    if (auto && shouldAutoMerge && passed) {
        try {
            await mergeBranch(sourceProjectRoot, branch);
            logger.success(`Merged ${branch} → ${baseBranch}`);
            await worktree.cleanup();
            return;
        } catch (err) {
            logger.warn(`Auto-merge failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    console.log();
    console.log(chalk.bold.cyan('── Worktree Ready ──'));
    console.log(chalk.gray(`Branch : ${branch}`));
    console.log(chalk.gray(`Path   : ${worktree.path}`));
    console.log(chalk.gray(`Base   : ${baseBranch}`));
    console.log();
    console.log(chalk.gray('Review the diff:'));
    console.log(chalk.white(`  git diff ${baseBranch}...${branch}`));
    console.log();

    if (!auto) {
        const { action } = await prompts({
            type: 'select',
            name: 'action',
            message: 'What would you like to do with the worktree?',
            choices: [
                { title: chalk.green('Merge') + ` — merge ${branch} into ${baseBranch}`, value: 'merge' },
                { title: chalk.yellow('Keep') + ' — leave the worktree for manual review', value: 'keep' },
                { title: chalk.red('Discard') + ' — delete the worktree and branch', value: 'discard' },
            ],
        });

        if (action === 'merge') {
            try {
                await mergeBranch(sourceProjectRoot, branch);
                logger.success(`Merged ${branch} → ${baseBranch}`);
                await worktree.cleanup();
            } catch (err) {
                logger.error(`Merge failed: ${err instanceof Error ? err.message : String(err)}`);
                logger.info(`Run manually: git merge ${branch}`);
            }
        } else if (action === 'discard') {
            await worktree.cleanup();
            logger.info('Worktree discarded.');
        } else {
            logger.info(`Worktree kept at: ${worktree.path}`);
            logger.info(`To merge later: aiagentflow discard --merge ${branch}`);
        }
    } else {
        logger.info(`Worktree kept. Run: aiagentflow discard --merge ${branch}`);
    }
}

// ── Dry-run ──

/**
 * Print the workflow's steps and settings without calling any agents.
 */
function printDryRun(
    task: string,
    workflow: WorkflowDefinition,
    config: AppConfig,
    contextDocs: ContextDocument[],
    sourceDocs: ContextDocument[],
    auto: boolean,
    maxIterations: number,
): void {
    logger.header('AI Workflow — Dry Run');
    console.log(chalk.gray(`Task: ${task}`));
    console.log(chalk.gray(`Workflow: ${workflow.name}${workflow.description ? ` — ${workflow.description}` : ''}`));
    console.log(chalk.gray(`Mode: ${config.workflow.mode}`));
    console.log(chalk.gray(`Max iterations: ${maxIterations}`));
    console.log();

    console.log(chalk.bold('  Steps'));
    console.log();
    workflow.steps.forEach((step, i) => {
        const agentConfig = config.agents[step.agent];
        const flags = [
            step.trigger === 'on-fail' ? 'on fail only' : undefined,
            step.checks.length > 0 ? `checks: ${step.checks.join(', ')}` : undefined,
            step.gate ? `gate: ${step.gate}` : undefined,
            step.onFail ? `on fail → ${step.onFail}` : undefined,
            step.next ? `next → ${step.next}` : undefined,
        ].filter(Boolean).join(' | ');

        console.log(chalk.bold(`  ${i + 1}. ${step.id} — ${AGENT_ROLE_LABELS[step.agent]}`));
        console.log(chalk.gray(`     Provider: ${agentConfig.provider} / ${agentConfig.model}`));
        if (step.description) console.log(chalk.gray(`     ${step.description}`));
        if (flags) console.log(chalk.gray(`     ${flags}`));
        console.log();
    });

    // Context documents
    if (contextDocs.length > 0) {
        console.log(chalk.bold('  Context Documents'));
        for (const doc of contextDocs) {
            console.log(chalk.gray(`    ${doc.source} (${doc.content.length} chars)`));
        }
        console.log();
    }

    if (!config.workflow.legacyFileBlocks) {
        console.log(chalk.bold('  Repository Map'));
        console.log(chalk.gray(config.project.repoMapTokens > 0
            ? `    Up to ~${config.project.repoMapTokens} tokens of file tree and symbols; agents read files on demand`
            : '    Disabled (project.repoMapTokens = 0)'));
        console.log();
    }

    // Source files (legacy mode only)
    if (sourceDocs.length > 0) {
        console.log(chalk.bold('  Source Files'));
        console.log(chalk.gray(`    ${sourceDocs.length} file(s) matching ${config.project.sourceGlobs.join(', ')}`));
        const totalChars = sourceDocs.reduce((sum, d) => sum + d.content.length, 0);
        console.log(chalk.gray(`    Total: ${totalChars.toLocaleString()} chars`));
        console.log();
    }

    // Workflow settings
    console.log(chalk.bold('  Workflow Settings'));
    console.log(chalk.gray(`    Human approval: ${auto ? 'off (--auto)' : config.workflow.humanApproval ? 'on' : 'off'}`));
    console.log(chalk.gray(`    Auto-run tests: ${config.workflow.autoRunTests}`));
    console.log(chalk.gray(`    Auto-commit: ${config.workflow.autoCommit}`));
    console.log(chalk.gray(`    Auto-create branch: ${config.workflow.autoCreateBranch}`));
    if (config.workflow.testCommand) {
        console.log(chalk.gray(`    Test command: ${config.workflow.testCommand}`));
    }
    if (config.workflow.lintCommand) {
        console.log(chalk.gray(`    Lint command: ${config.workflow.lintCommand}`));
    }
    if (config.workflow.formatCommand) {
        console.log(chalk.gray(`    Format command: ${config.workflow.formatCommand}`));
    }
    console.log();

    // Project settings
    console.log(chalk.bold('  Project'));
    console.log(chalk.gray(`    Language: ${config.project.language}`));
    console.log(chalk.gray(`    Framework: ${config.project.framework}`));
    console.log(chalk.gray(`    Test framework: ${config.project.testFramework}`));
    console.log();

    logger.info('Dry run complete. No agents were called and no files were modified.');
}

// ── Private helpers ──

/** Apply a workflow mode preset to the config, overriding relevant fields. */
function applyModePreset(config: AppConfig, mode: string): void {
    const validModes = Object.keys(WORKFLOW_PRESETS);
    if (!validModes.includes(mode)) {
        throw new WorkflowError(
            `Invalid workflow mode: "${mode}". Valid modes: ${validModes.join(', ')}`,
            { mode, validModes },
        );
    }

    const preset = WORKFLOW_PRESETS[mode as WorkflowMode];
    config.workflow.mode = mode as WorkflowMode;
    config.workflow.maxIterations = preset.maxIterations;
    config.workflow.humanApproval = preset.humanApproval;
    config.workflow.autoCommit = preset.autoCommit;

    for (const [role, temp] of Object.entries(preset.temperatures)) {
        const agentCfg = config.agents[role as keyof typeof config.agents];
        if (agentCfg) {
            agentCfg.temperature = temp;
        }
    }
}

/** Full source files for prompts, only needed in legacyFileBlocks mode. */
function loadLegacySources(projectRoot: string, config: AppConfig): ContextDocument[] {
    return config.workflow.legacyFileBlocks ? loadSourceFiles(projectRoot, config.project.sourceGlobs) : [];
}

/** Print a colored summary of the workflow execution. */
function printWorkflowSummary(ctx: WorkflowContext): void {
    console.log();
    logger.header('Workflow Summary');
    console.log(chalk.gray(`Task: ${ctx.task}`));
    console.log(chalk.gray(`Workflow: ${ctx.workflow}`));
    console.log(chalk.gray(`Status: ${ctx.status}`));
    console.log(chalk.gray(`Iterations: ${ctx.iteration}/${ctx.maxIterations}`));

    if (ctx.generatedFiles.length > 0) {
        console.log();
        console.log(chalk.bold('  Files modified:'));
        for (const file of ctx.generatedFiles) {
            console.log(chalk.gray(`    ${file}`));
        }
    }

    if (ctx.history.length > 0) {
        console.log();
        console.log(chalk.bold('  Steps:'));
        for (const record of ctx.history) {
            const mark = record.outcome === 'passed' ? chalk.green('✓') : record.outcome === 'failed' ? chalk.yellow('↺') : chalk.red('✗');
            const detail = record.detail ? chalk.gray(` — ${record.detail}`) : '';
            console.log(`    ${mark} ${record.step}${detail}`);
        }
    }

    console.log();
    if (ctx.status === 'passed') {
        logger.success('Task completed successfully!');
    } else if (ctx.status === 'failed') {
        logger.error(`Task failed${ctx.failureReason ? `: ${ctx.failureReason}` : '.'}`);
    } else {
        logger.warn(`Task stopped at step "${ctx.step ?? ''}"`);
    }
}
