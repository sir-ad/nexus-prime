import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { statSync, readdirSync } from 'fs';
import * as path from 'path';
import { Adapter, NetworkMessage } from '../core/types.js';
import { NexusPrime } from '../../index.js';
import {
    TokenSupremacyEngine,
    formatReadingPlan,
    type FileRef
} from '../../engines/token-supremacy.js';
import { GhostPass } from '../../phantom/index.js';
import { GuardrailEngine } from '../../engines/guardrails-bridge.js';

const tokenEngine = new TokenSupremacyEngine();
const guardrailEngine = new GuardrailEngine();

export class MCPAdapter implements Adapter {
    name = 'mcp';
    type = 'mcp' as const;
    connected = false;
    agents: string[] = [];

    private server: Server;
    private nexusRef?: NexusPrime;

    constructor() {
        this.server = new Server(
            { name: 'nexus-prime-mcp', version: '0.2.0' },
            { capabilities: { tools: {} } }
        );
        this.setupToolHandlers();
    }

    setNexusRef(nexus: NexusPrime) {
        this.nexusRef = nexus;
    }

    private setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                // ── Memory ────────────────────────────────────────────────────────
                {
                    name: 'nexus_store_memory',
                    description: 'Store a finding, insight, or memory into the Nexus Prime Cortex graph. High-priority items auto-fission to long-term memory.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            content: { type: 'string', description: 'The knowledge to store' },
                            priority: { type: 'number', description: 'Priority 0-1 (default 0.7). Use 1.0 for critical insights.' },
                            tags: { type: 'array', items: { type: 'string' }, description: 'Tags e.g. bug, architecture, decision' }
                        },
                        required: ['content'],
                    },
                },
                {
                    name: 'nexus_recall_memory',
                    description: 'Retrieve relevant context from Nexus Prime. Call at the START of each session to recover prior knowledge.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'What are you trying to remember or find?' },
                            k: { type: 'number', description: 'Number of results (default 5)' }
                        },
                        required: ['query'],
                    },
                },
                {
                    name: 'nexus_memory_stats',
                    description: 'Get stats about what Nexus Prime knows: tier counts, top tags, Zettelkasten links.',
                    inputSchema: { type: 'object', properties: {}, required: [] },
                },
                // ── Token optimization ────────────────────────────────────────────
                {
                    name: 'nexus_optimize_tokens',
                    description: 'Generate a token-efficient file reading plan BEFORE reading files. Returns which to read fully, outline, or skip, plus estimated savings.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            task: { type: 'string', description: 'Task description' },
                            files: { type: 'array', items: { type: 'string' }, description: 'File paths to analyze. If omitted, auto-scans src/' },
                            budget: { type: 'number', description: 'Token budget override' }
                        },
                        required: ['task'],
                    },
                },
                // ── Mindkit ──────────────────────────────────────────────────────
                {
                    name: 'nexus_mindkit_check',
                    description: 'Check an action against Mindkit guardrails before executing. Returns PASS/FAIL, score 0-100, violations and actionable suggestions. Always call when token budget may be exceeded or before destructive operations.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            action: {
                                type: 'string',
                                description: 'The action or prompt to validate'
                            },
                            tokenCount: {
                                type: 'number',
                                description: 'Estimated token count of current context'
                            },
                            filesToModify: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Files that will be modified'
                            },
                            isDestructive: {
                                type: 'boolean',
                                description: 'True if operation could cause data loss'
                            }
                        },
                        required: ['action']
                    }
                },
                {
                    name: 'nexus_ghost_pass',
                    description: 'Read-only pre-flight analysis. Returns risk areas, reading plan, and worker approaches WITHOUT modifying anything.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            goal: { type: 'string', description: 'What you want to accomplish' },
                            files: { type: 'array', items: { type: 'string' }, description: 'Relevant file paths' }
                        },
                        required: ['goal'],
                    },
                },
            ],
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            if (!this.nexusRef) {
                throw new McpError(ErrorCode.InternalError, 'NexusPrime reference not set in MCP adapter.');
            }

            switch (request.params.name) {

                case 'nexus_store_memory': {
                    const content = String(request.params.arguments?.content ?? '');
                    const priority = Number(request.params.arguments?.priority ?? 0.7);
                    const tags = Array.isArray(request.params.arguments?.tags)
                        ? (request.params.arguments.tags as unknown[]).map(String)
                        : [];
                    const id = this.nexusRef.storeMemory(content, priority, tags);
                    return {
                        content: [{
                            type: 'text',
                            text: `✅ Stored in Nexus memory (id: ${id}, priority: ${priority})\nTags: ${tags.join(', ') || 'none'}`,
                        }],
                    };
                }

                case 'nexus_recall_memory': {
                    const query = String(request.params.arguments?.query ?? '');
                    const k = Number(request.params.arguments?.k ?? 5);
                    const memories = await this.nexusRef.recallMemory(query, k);
                    return {
                        content: [{
                            type: 'text',
                            text: memories.length > 0
                                ? `🧠 ${memories.length} memories recalled for "${query}":\n\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n\n')}`
                                : `No memories found for "${query}". Fresh session or new topic.`,
                        }],
                    };
                }

                case 'nexus_memory_stats': {
                    const stats = this.nexusRef.getMemoryStats();
                    return {
                        content: [{
                            type: 'text',
                            text: [
                                '🧠 Nexus Prime Memory',
                                `  Prefrontal (working):  ${stats.prefrontal} items`,
                                `  Hippocampus (recent):  ${stats.hippocampus} items`,
                                `  Cortex (long-term):    ${stats.cortex} items`,
                                `  Zettelkasten links:    ${stats.totalLinks}`,
                                `  Top tags: ${stats.topTags.join(', ') || 'none yet'}`,
                                stats.oldestEntry
                                    ? `  Oldest entry: ${new Date(stats.oldestEntry).toLocaleDateString()}`
                                    : '  No memories yet.'
                            ].join('\n'),
                        }],
                    };
                }

                case 'nexus_optimize_tokens': {
                    const task = String(request.params.arguments?.task ?? '');
                    const rawFiles = Array.isArray(request.params.arguments?.files)
                        ? (request.params.arguments.files as unknown[]).map(String)
                        : null;
                    const filePaths = rawFiles ?? this.scanSourceFiles(process.cwd());

                    const files: FileRef[] = filePaths.map(p => {
                        try {
                            const stat = statSync(p);
                            return { path: p, sizeBytes: stat.size, lastModified: stat.mtimeMs };
                        } catch {
                            return { path: p, sizeBytes: 0 };
                        }
                    });

                    const plan = tokenEngine.plan(task, files);
                    const formatted = formatReadingPlan(plan);

                    // Persist the decision
                    this.nexusRef.storeMemory(
                        `Token plan for "${task.slice(0, 80)}": ` +
                        `${plan.files.filter(a => a.action === 'full').length} full reads, ` +
                        `saved ~${plan.savings.toLocaleString()} tokens.`,
                        0.5, ['#token-plan']
                    );

                    return { content: [{ type: 'text', text: formatted }] };
                }

                case 'nexus_mindkit_check': {
                    const args = request.params.arguments ?? {};
                    const ctx = {
                        action: String(args?.action ?? ''),
                        tokenCount: args?.tokenCount as number | undefined,
                        filesToModify: args?.filesToModify as string[] | undefined,
                        isDestructive: args?.isDestructive as boolean | undefined,
                    };
                    const result = guardrailEngine.check(ctx);

                    // Store violations in Nexus memory
                    if (result.violations.length > 0) {
                        this.nexusRef.storeMemory(
                            `[GUARDRAIL BLOCK] ${ctx.action.slice(0, 80)} — ${result.violations.map(v => v.id).join(', ')}`,
                            0.7, ['#guardrail', '#mindkit']
                        );
                    }

                    return {
                        content: [{
                            type: 'text', text: JSON.stringify({
                                passed: result.passed,
                                score: Math.round(result.score * 100),
                                violations: result.violations,
                                warnings: result.warnings,
                                summary: guardrailEngine.format(result)
                            }, null, 2)
                        }]
                    };
                }

                case 'nexus_ghost_pass': {
                    const goal = String(request.params.arguments?.goal ?? '');
                    const rawFiles = Array.isArray(request.params.arguments?.files)
                        ? (request.params.arguments.files as unknown[]).map(String)
                        : [];

                    const files: FileRef[] = rawFiles.map(p => {
                        try {
                            const stat = statSync(p);
                            return { path: p, sizeBytes: stat.size, lastModified: stat.mtimeMs };
                        } catch {
                            return { path: p, sizeBytes: 0 };
                        }
                    });

                    const ghost = new GhostPass(process.cwd());
                    const report = await ghost.analyze(goal, files);

                    const text = [
                        `👻 Ghost Pass — "${goal}"`,
                        `Task ID: ${report.taskId}`,
                        `Est. tokens: ${report.totalEstimatedTokens.toLocaleString()}`,
                        '',
                        `⚠️  Risks: ${report.riskAreas.length > 0 ? report.riskAreas.join(' | ') : 'none detected'}`,
                        '',
                        formatReadingPlan(report.readingPlan),
                        '',
                        `🔀 Worker Approaches:`,
                        ...report.workerAssignments.map((w, i) =>
                            `  ${i + 1}. "${w.approach}" — budget: ${w.tokenBudget.toLocaleString()} tokens`
                        ),
                    ].join('\n');

                    this.nexusRef.storeMemory(
                        `Ghost pass for "${goal.slice(0, 80)}": ${report.riskAreas.length} risks identified.`,
                        0.6, ['#ghost-pass']
                    );

                    return { content: [{ type: 'text', text }] };
                }

                default:
                    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
            }
        });

        this.server.onerror = (error) => console.error('[MCP Error]', error);
    }

    private scanSourceFiles(cwd: string): string[] {
        const srcDir = path.join(cwd, 'src');
        try {
            const walk = (dir: string): string[] =>
                readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory() && !entry.name.startsWith('.')) return walk(full);
                    if (entry.isFile() && /\.[jt]s$/.test(entry.name)) return [full];
                    return [];
                });
            return walk(srcDir).slice(0, 30);
        } catch {
            return [];
        }
    }

    async connect(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        this.connected = true;
        console.error('[MCP Adapter] Connected — 6 tools active');
    }

    async disconnect(): Promise<void> {
        await this.server.close();
        this.connected = false;
        console.error('[MCP Adapter] Disconnected');
    }

    async send(_message: NetworkMessage): Promise<void> { /* future */ }
    receive(_message: NetworkMessage): void { /* future */ }
}
