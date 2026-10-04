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
}

/**
 * Create an agent instance for the specified role using the app config.
 * Automatically:
 *   - Loads and injects project memories relevant to this role
 *   - Builds the agent's ToolRegistry: extra tools plus `remember` for eligible roles
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
    const tools = new ToolRegistry(factoryOpts?.tools ?? []);
    if (!memoryDisabled && REMEMBER_ELIGIBLE_ROLES.has(role)) {
        tools.register(createRememberTool(role, projectRoot));
    }

    const options = {
        model: agentConfig.model,
        temperature: agentConfig.temperature,
        maxTokens: agentConfig.maxTokens,
        maxTurns: agentConfig.maxTurns,
        tools,
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
