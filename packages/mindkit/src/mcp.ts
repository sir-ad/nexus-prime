/**
 * Mindkit MCP Server
 *
 * Exposes 3 tools via the Model Context Protocol:
 *   - mindkit_check_guardrails  — validate action against all rules
 *   - mindkit_get_skill         — get full skill instructions by name
 *   - mindkit_list_workflows    — list all available workflow slash commands
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GuardrailEngine } from './guardrails.js';
import { SkillLoader } from './skill-loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// MCP Server
// ─────────────────────────────────────────────────────────────────────────────

export class MindkitMCPServer {
    private server: Server;
    private guardrails: GuardrailEngine;
    private skills: SkillLoader;

    constructor(cwd?: string) {
        this.guardrails = new GuardrailEngine();
        this.skills = new SkillLoader(cwd ?? process.cwd());

        this.server = new Server(
            { name: 'mindkit', version: '0.1.0' },
            { capabilities: { tools: {} } }
        );

        this.setupToolHandlers();
    }

    private setupToolHandlers(): void {
        // ── List tools ────────────────────────────────────────────────────────
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'mindkit_check_guardrails',
                    description: 'Check an action against Mindkit guardrails. Returns PASS/FAIL with any violations and suggestions. Call before any significant operation.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            action: {
                                type: 'string',
                                description: 'The action or prompt text to evaluate'
                            },
                            tokenCount: {
                                type: 'number',
                                description: 'Estimated token count of current context (optional)'
                            },
                            filesToModify: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'List of file paths that will be modified (optional)'
                            },
                            isDestructive: {
                                type: 'boolean',
                                description: 'Set to true if the operation is destructive (delete, wipe, etc.)'
                            }
                        },
                        required: ['action']
                    }
                },
                {
                    name: 'mindkit_get_skill',
                    description: 'Retrieve full instructions for a named skill from .agent/skills/. Use this to get step-by-step guidance for specific tasks.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            name: {
                                type: 'string',
                                description: 'Skill name or filename (e.g. "code-review" or "search")'
                            }
                        },
                        required: ['name']
                    }
                },
                {
                    name: 'mindkit_list_workflows',
                    description: 'List all available workflow slash commands from .agent/workflows/. Returns command names, descriptions, and step counts.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            includeSteps: {
                                type: 'boolean',
                                description: 'Include step details in response (default: false)'
                            }
                        }
                    }
                }
            ]
        }));

        // ── Handle tool calls ─────────────────────────────────────────────────
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            switch (name) {
                case 'mindkit_check_guardrails': {
                    const ctx = {
                        action: (args?.action as string) ?? '',
                        tokenCount: args?.tokenCount as number | undefined,
                        filesToModify: args?.filesToModify as string[] | undefined,
                        isDestructive: args?.isDestructive as boolean | undefined,
                    };

                    const result = this.guardrails.check(ctx);
                    const formatted = this.guardrails.format(result);

                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                passed: result.passed,
                                score: parseFloat((result.score * 100).toFixed(0)),
                                violations: result.violations.length,
                                warnings: result.warnings.length,
                                summary: formatted,
                                details: {
                                    violations: result.violations,
                                    warnings: result.warnings
                                }
                            }, null, 2)
                        }]
                    };
                }

                case 'mindkit_get_skill': {
                    const skillName = (args?.name as string) ?? '';
                    const skill = this.skills.getSkill(skillName);

                    if (!skill) {
                        const allSkills = this.skills.loadSkills().map(s => s.name);
                        return {
                            content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    found: false,
                                    requested: skillName,
                                    available: allSkills,
                                    message: `Skill "${skillName}" not found. Available: ${allSkills.join(', ') || 'none'}`
                                }, null, 2)
                            }]
                        };
                    }

                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                found: true,
                                name: skill.name,
                                description: skill.description,
                                tags: skill.tags,
                                instructions: skill.instructions
                            }, null, 2)
                        }]
                    };
                }

                case 'mindkit_list_workflows': {
                    const includeSteps = (args?.includeSteps as boolean) ?? false;
                    const workflows = this.skills.loadWorkflows();

                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                count: workflows.length,
                                workflows: workflows.map(w => ({
                                    slashCommand: w.slashCommand,
                                    name: w.name,
                                    description: w.description,
                                    stepCount: w.steps.length,
                                    turboAll: w.isTurboAll,
                                    ...(includeSteps ? { steps: w.steps } : {})
                                }))
                            }, null, 2)
                        }]
                    };
                }

                default:
                    return {
                        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                        isError: true
                    };
            }
        });
    }

    async start(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        // stdio MCP — process.stderr for debug
        process.stderr.write('🧠 Mindkit MCP server started (stdio)\n');
    }
}

export const createMindkitMCPServer = (cwd?: string) => new MindkitMCPServer(cwd);
