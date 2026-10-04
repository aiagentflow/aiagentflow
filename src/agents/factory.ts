/**
 * Agent factory — creates agent instances from config.
 *
 * Wires together the provider registry + agent config + prompt library
 * to produce ready-to-use agent instances.
 *
 * Dependency direction: factory.ts → agents/roles/*, providers/registry
 * Used by: workflow runner
 */

import type { AgentRole } from './types.js';
import type { BaseAgent } from './base.js';
import type { AppConfig } from '../core/config/types.js';
import { ToolRegistry, type Tool } from '../tools/registry.js';
import { createBuiltinTools, commandPolicyFromConfig } from '../tools/builtin.js';
import type { ChangeSet } from '../tools/repo.js';
import type { ConfirmAnswer } from '../tools/command.js';
import { buildTestCommand } from '../utils/package-manager.js';
import { createProvider } from '../providers/registry.js';
import { ArchitectAgent } from './roles/architect.js';
import { CoderAgent } from './roles/coder.js';
import { ReviewerAgent } from './roles/reviewer.js';
import { SecurityAgent } from './roles/security.js';
import { TesterAgent } from './roles/tester.js';
import { FixerAgent } from './roles/fixer.js';
import { JudgeAgent } from './roles/judge.js';
import { WorkflowError } from '../core/errors.js';
import { loadMemoriesForRole, formatMemoriesForAgent } from '../memory/loader.js';
import { createRememberTool, REMEMBER_ELIGIBLE_ROLES } from '../memory/tool.js';

export interface AgentFactoryOptions {
    /** Extra tools for this agent (e.g. MCP tools allowed for its role). */
    tools?: Tool[];
    /** When true, the remember tool is not added even for eligible roles. */
    memoryDisabled?: boolean;
    /** Records files the agent writes through edit_file / write_file. */
    changes?: ChangeSet;
    /** Interactive approval for commands that need it. Omit for non-interactive runs. */
    confirmCommand?: (command: string) => Promise<ConfirmAnswer>;
}

/**
 * Create an agent instance for the specified role using the app config.
 * Automatically:
 *   - Loads and injects project memories relevant to this role
 *   - Builds the agent's ToolRegistry: built-in repo/command tools allowed for the role
 *     (none in legacyFileBlocks mode), extra tools, and `remember` for eligible roles
 *
 * @param role - Which agent to create
 * @param config - Full application config
 * @param projectRoot - Project root directory for prompt loading
 * @param factoryOpts - Optional extra tools and memory flags
 */
export function createAgent(
    role: AgentRole,
    config: AppConfig,
    projectRoot: string,
    factoryOpts?: AgentFactoryOptions,
): BaseAgent {
    const agentConfig = config.agents[role];
    const provider = createProvider(agentConfig.provider, config.providers);

    const memoryDisabled = factoryOpts?.memoryDisabled ?? false;
    const legacyFileBlocks = config.workflow.legacyFileBlocks;
    const builtin = legacyFileBlocks ? [] : createBuiltinTools(role, {
        root: projectRoot,
        changes: factoryOpts?.changes,
        policy: commandPolicyFromConfig(config.permissions, [
            config.workflow.testCommand ?? buildTestCommand(config.project.testFramework, projectRoot),
            config.workflow.lintCommand,
            config.workflow.formatCommand,
        ]),
        allowedTools: config.permissions.tools[role],
        commandTimeoutMs: config.permissions.commandTimeoutMs,
        confirm: factoryOpts?.confirmCommand,
    });
    const tools = new ToolRegistry([...builtin, ...(factoryOpts?.tools ?? [])]);
    if (!memoryDisabled && REMEMBER_ELIGIBLE_ROLES.has(role)) {
        tools.register(createRememberTool(role, projectRoot));
    }

    const options = {
        model: agentConfig.model,
        temperature: agentConfig.temperature,
        maxTokens: agentConfig.maxTokens,
        maxTurns: agentConfig.maxTurns,
        tools,
        legacyFileBlocks,
    };

    let agent: BaseAgent;
    switch (role) {
        case 'architect':
            agent = new ArchitectAgent(provider, options, projectRoot);
            break;
        case 'coder':
            agent = new CoderAgent(provider, options, projectRoot);
            break;
        case 'reviewer':
            agent = new ReviewerAgent(provider, options, projectRoot);
            break;
        case 'security':
            agent = new SecurityAgent(provider, options, projectRoot);
            break;
        case 'tester':
            agent = new TesterAgent(provider, options, projectRoot);
            break;
        case 'fixer':
            agent = new FixerAgent(provider, options, projectRoot);
            break;
        case 'judge':
            agent = new JudgeAgent(provider, options, projectRoot);
            break;
        default:
            throw new WorkflowError(`Unknown agent role: ${role}`, { role });
    }

    // Inject memories into the agent's system prompt
    if (!memoryDisabled) {
        const memories = loadMemoriesForRole(projectRoot, role);
        if (memories.full.length > 0) {
            agent.memorySection = formatMemoriesForAgent(memories);
        }
    }

    return agent;
}
