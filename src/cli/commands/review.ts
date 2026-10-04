/**
 * `aiagentflow review`: review a diff with the reviewer and security agents.
 *
 * Sources: uncommitted changes (default), --staged, --diff <range>, or --pr <n>.
 * Nothing is edited. The command fails (exit 1) when an issue reaches the
 * --fail-on severity, and can post the findings as an inline PR review.
 *
 * Dependency direction: review.ts → commander, core/review, integrations/diff, integrations/github, workflow/runner
 * Used by: cli/index.ts
 */

import { Command, Option } from 'commander';
import { configExists } from '../../core/config/manager.js';
import { runWorkflow } from '../../core/workflow/runner.js';
import { getWorkflow } from '../../core/workflow/workflow-loader.js';
import {
    REVIEW_COMMAND_WORKFLOW,
    FAIL_ON_VALUES,
    blockingFindings,
    buildReviewComments,
    collectFindings,
    formatReviewReport,
    type FailOn,
} from '../../core/review.js';
import { getDiff, type DiffSource, type ReviewDiff } from '../../integrations/diff.js';
import { postPRReview } from '../../integrations/github.js';
import { enableJsonOutput, OUTPUT_FORMATS, type OutputFormat } from '../utils/json-output.js';
import { ExitCode, exitCodeForError, exitCodeForRun } from '../utils/exit-codes.js';
import { addBudgetOptions, budgetFromFlags, type BudgetFlags } from '../utils/run-options.js';
import { logger } from '../../utils/logger.js';

/** Diffs larger than this are truncated in the prompt; agents can still read the files. */
const MAX_DIFF_CHARS = 120_000;

export interface ReviewCommandOptions extends BudgetFlags {
    staged?: boolean;
    diff?: string;
    pr?: number;
    workflow?: string;
    failOn: FailOn;
    comment?: boolean;
    output: OutputFormat;
    stream: boolean;
}

export const reviewCommand = addBudgetOptions(new Command('review')
    .description('Review a diff with the reviewer and security agents (no edits)')
    .option('--staged', 'Review staged changes')
    .option('--diff <range>', 'Review a git range, e.g. main...HEAD')
    .option('--pr <number>', 'Review a GitHub pull request (needs the gh CLI)', parseInt)
    .option('-w, --workflow <name>', 'Workflow to run instead of the built-in reviewer + security review')
    .addOption(new Option('--fail-on <severity>', 'Exit 1 when an issue is at or above this severity').choices([...FAIL_ON_VALUES]).default('high'))
    .option('--comment', 'Post the findings as an inline review on the PR (with --pr)')
    .addOption(new Option('--output <format>', 'text (default) or json: NDJSON run events on stdout').choices([...OUTPUT_FORMATS]).default('text'))
    .option('--no-stream', 'Disable real-time streaming of agent output'))
    .action(async (options: ReviewCommandOptions) => {
        process.exitCode = await runReview(options);
    });

/** Run a review and return the process exit code. */
export async function runReview(options: ReviewCommandOptions, projectRoot = process.cwd()): Promise<number> {
    if (!configExists(projectRoot)) {
        logger.error('No configuration found. Run "aiagentflow init" first.');
        return ExitCode.Config;
    }

    const sources = [options.staged, options.diff, options.pr].filter(v => v !== undefined && v !== false);
    if (sources.length > 1) {
        logger.error('Use only one of --staged, --diff, and --pr.');
        return ExitCode.Config;
    }
    if (options.comment && !options.pr) {
        logger.error('--comment needs --pr.');
        return ExitCode.Config;
    }

    const events = options.output === 'json' ? enableJsonOutput() : undefined;
    const source: DiffSource = options.pr ? { kind: 'pr', number: options.pr }
        : options.diff ? { kind: 'range', range: options.diff }
            : options.staged ? { kind: 'staged' }
                : { kind: 'working' };

    try {
        const diff = await getDiff(source, projectRoot);
        if (!diff.diff.trim()) {
            logger.info(`Nothing to review: no ${diff.label}.`);
            return ExitCode.Success;
        }
        logger.info(`Reviewing ${diff.label}: ${diff.files.length} file(s)`);

        const ctx = await runWorkflow({
            projectRoot,
            task: reviewTask(diff),
            definition: options.workflow ? getWorkflow(projectRoot, options.workflow).definition : REVIEW_COMMAND_WORKFLOW,
            // A review never edits files and never needs to ask anything
            headless: true,
            isolation: 'inplace',
            streaming: options.stream && options.output !== 'json',
            events,
            budget: budgetFromFlags(options),
            contextDocuments: [{ source: diff.label, name: `Diff under review (${diff.label})`, content: diffForPrompt(diff.diff) }],
            initialContext: { generatedFiles: diff.files, changeSummary: describeChange(diff) },
            showSummary: options.output !== 'json',
        });

        // Infrastructure failures (budget, provider) win over findings
        if (ctx.status === 'failed' && ctx.failureKind !== 'checks') return exitCodeForRun(ctx);

        const report = formatReviewReport(diff.label, ctx.verdicts, options.failOn);
        if (options.output !== 'json') console.log(`\n${report}\n`);

        if (options.comment && options.pr) {
            const { comments, unplaced } = buildReviewComments(collectFindings(ctx.verdicts), diff.diff);
            const extra = unplaced.length > 0 ? `\n\n_${unplaced.length} finding(s) could not be placed on a diff line and are listed above._` : '';
            await postPRReview(options.pr, { body: report + extra, comments, commitId: diff.headSha }, projectRoot);
            logger.success(`Posted a review on PR #${options.pr} with ${comments.length} inline comment(s).`);
        }

        const blocking = blockingFindings(collectFindings(ctx.verdicts), options.failOn);
        // A custom workflow's own gates can also fail the review
        return blocking.length > 0 || ctx.status === 'failed' ? ExitCode.Failed : ExitCode.Success;
    } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        return exitCodeForError(err);
    }
}

function reviewTask(diff: ReviewDiff): string {
    return [
        `Review ${diff.label}${diff.title ? `: ${diff.title}` : ''}.`,
        'The full diff is under Reference Documents and the changed files are listed under Modified Files.',
        'Read the changed files with read_file for surrounding context. Do not modify anything.',
        'Report each problem with its file and the line number on the new side of the diff.',
    ].join('\n');
}

function describeChange(diff: ReviewDiff): string {
    const parts = [diff.title ? `# ${diff.title}` : `Changes: ${diff.label}`];
    if (diff.description) parts.push(diff.description);
    parts.push(`Changed files:\n${diff.files.map(f => `- ${f}`).join('\n')}`);
    return parts.join('\n\n');
}

function diffForPrompt(diff: string): string {
    if (diff.length <= MAX_DIFF_CHARS) return `\`\`\`diff\n${diff}\n\`\`\``;
    return `\`\`\`diff\n${diff.slice(0, MAX_DIFF_CHARS)}\n\`\`\`\n\n(Diff truncated at ${MAX_DIFF_CHARS} characters; read the remaining changed files directly.)`;
}
