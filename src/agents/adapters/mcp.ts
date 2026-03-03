import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { statSync, readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Adapter, NetworkMessage } from '../core/types.js';
import { NexusPrime } from '../../index.js';
import {
    TokenSupremacyEngine,
    formatReadingPlan,
    type FileRef
} from '../../engines/token-supremacy.js';
import { GhostPass, PhantomWorker } from '../../phantom/index.js';
import { MergeOracle } from '../../phantom/merge-oracle.js';
import { GuardrailEngine } from '../../engines/guardrails-bridge.js';
import { SessionDNAManager } from '../../engines/session-dna.js';
import { ContextAssembler } from '../../engines/context-assembler.js';
import { GraphMemoryEngine } from '../../engines/graph-memory.js';
import { GraphTraversalEngine } from '../../engines/graph-traversal.js';
import { HybridRetriever } from '../../engines/hybrid-retriever.js';
import { nexusEventBus } from '../../engines/event-bus.js';

const tokenEngine = new TokenSupremacyEngine();
const guardrailEngine = new GuardrailEngine();

// Lazy-initialized Graph Engine (separate DB from core memory)
let _graphEngine: GraphMemoryEngine | null = null;
let _traversalEngine: GraphTraversalEngine | null = null;
let _hybridRetriever: HybridRetriever | null = null;

function getGraphEngine(): GraphMemoryEngine {
    if (!_graphEngine) _graphEngine = new GraphMemoryEngine();
    return _graphEngine;
}
function getTraversalEngine(): GraphTraversalEngine {
    if (!_traversalEngine) _traversalEngine = new GraphTraversalEngine(getGraphEngine().getDb());
    return _traversalEngine;
}
function getHybridRetriever(): HybridRetriever {
    if (!_hybridRetriever) _hybridRetriever = new HybridRetriever(getGraphEngine());
    return _hybridRetriever;
}

// Derive project root from this file's location (dist/agents/adapters/mcp.js → project root)
const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..');

/** Session-level telemetry tracker */
class SessionTelemetry {
    private startTime = Date.now();
    private callCount = 0;
    private tokensOptimized = 0;
    private memoriesStored = 0;
    private memoriesRecalled = 0;

    recordCall() { this.callCount++; }
    recordTokens(saved: number) { this.tokensOptimized += saved; }
    recordStore() { this.memoriesStored++; }
    recordRecall(count: number) { this.memoriesRecalled += count; }

    /** Rich inline notification for memory store events */
    notifyStore(priority: number, tags: string[], memStats: { cortex: number; totalLinks: number }): string {
        return [
            `\n── 💾 Memory Stored ──`,
            `Priority: ${priority} │ Tags: ${tags.join(', ') || 'none'}`,
            `Cortex now holds ${memStats.cortex} long-term memories │ ${memStats.totalLinks} Zettelkasten links`,
        ].join('\n');
    }

    /** Rich inline notification for memory recall events */
    notifyRecall(count: number, query: string, memStats: { hippocampus: number; cortex: number }): string {
        return [
            `\n── 🧠 Memory Recalled ──`,
            `${count} memories matched query: "${query.slice(0, 60)}"`,
            `Hippocampus cache: ${memStats.hippocampus}/200 │ Cortex: ${memStats.cortex} entries`,
        ].join('\n');
    }

    /** Rich inline notification for token optimization events */
    notifyTokens(task: string, savings: number, pct: number, fileCount: number): string {
        return [
            `\n── ⚡ Tokens Optimized ──`,
            `Task: "${task.slice(0, 60)}"`,
            `Savings: ${savings.toLocaleString()} tokens (${pct}%) │ ${fileCount} files routed`,
            `Session total: ${(this.tokensOptimized / 1000).toFixed(1)}k tokens saved across ${this.callCount} calls`,
        ].join('\n');
    }

    /** Contextual planning nudges based on what just happened */
    planningNudge(event: string, context: Record<string, any>): string {
        const nudges: string[] = [];

        switch (event) {
            case 'recall':
                if ((context.count ?? 0) > 3) {
                    nudges.push('You recalled many memories — consider nexus_optimize_tokens before reading the files mentioned.');
                }
                if ((context.count ?? 0) === 0) {
                    nudges.push('No memories found. This is a fresh topic — explore carefully and store key findings.');
                }
                break;
            case 'optimize':
                if ((context.fullReads ?? 0) > 3) {
                    nudges.push('Multiple files need full reading — consider nexus_ghost_pass before modifying them.');
                }
                break;
            case 'ghost_pass':
                if ((context.risks ?? 0) > 0) {
                    nudges.push('Risks detected — strongly consider nexus_spawn_workers for parallel exploration.');
                }
                break;
            case 'store':
                if ((context.priority ?? 0) > 0.8) {
                    nudges.push('High-priority insight stored. Consider nexus_audit_evolution to check for recurring patterns.');
                }
                break;
            case 'mindkit_fail':
                nudges.push('Guardrail FAILED. Do NOT proceed. Re-scope the task or use nexus_ghost_pass for a safer approach.');
                break;
            case 'high_call_count':
                if (this.callCount > 20) {
                    nudges.push('You have made 20+ tool calls. Consider storing a session summary via nexus_store_memory.');
                }
                break;
        }

        if (nudges.length === 0) return '';
        return `\n<planning engine="nexus-prime">\n${nudges.map(n => `  → ${n}`).join('\n')}\n</planning>`;
    }

    format(memStats?: { totalLinks: number; prefrontal: number; hippocampus: number; cortex: number }): string {
        const uptime = Math.round((Date.now() - this.startTime) / 1000);
        const uptimeStr = uptime < 60 ? `${uptime}s` : `${Math.round(uptime / 60)}m`;
        const parts = [
            `${this.callCount} calls`,
            this.tokensOptimized > 0 ? `${(this.tokensOptimized / 1000).toFixed(1)}k tokens saved` : null,
            this.memoriesStored > 0 ? `${this.memoriesStored} stored` : null,
            this.memoriesRecalled > 0 ? `${this.memoriesRecalled} recalled` : null,
            memStats ? `${memStats.totalLinks} Zettel links` : null,
        ].filter(Boolean);
        // Grain-inspired semantic structure
        return `\n<state type="telemetry" engine="nexus-prime" uptime="${uptimeStr}">\n${parts.join(' │ ')}\n</state>`;
    }
}

export class MCPAdapter implements Adapter {
    name = 'mcp';
    type = 'mcp' as const;
    connected = false;
    agents: string[] = [];

    private server: Server;
    private nexusRef?: NexusPrime;
    private telemetry = new SessionTelemetry();
    private sessionDNA: SessionDNAManager;

    constructor() {
        this.server = new Server(
            { name: 'nexus-prime-mcp', version: '0.3.0' },
            { capabilities: { tools: {} } }
        );
        this.sessionDNA = new SessionDNAManager(crypto.randomUUID?.() ?? `session-${Date.now()}`);
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
                    description: 'Store a finding, insight, or memory into Nexus Prime. Use after discovering bugs, architecture decisions, or patterns. Priority 0-1 (1.0 = critical). High-priority items auto-fission to long-term memory.',
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
                    description: 'Retrieve relevant context from Nexus Prime. Call at the START of each session to recover prior knowledge. Also call mid-session when encountering a topic that may have been researched before.',
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
                    description: 'Get stats about what Nexus Prime knows: tier counts, top tags, Zettelkasten links. Call at session start after recall to gauge available knowledge depth.',
                    inputSchema: { type: 'object', properties: {}, required: [] },
                },
                // ── Token optimization ────────────────────────────────────────────
                {
                    name: 'nexus_optimize_tokens',
                    description: 'Generate a token-efficient file reading plan BEFORE reading files. MANDATORY when reading 3+ files. Returns which files to read fully, outline-only, or skip. Typically saves 50-90% tokens per session.',
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
                    description: 'Check an action against Mindkit guardrails before executing. MANDATORY before destructive operations (deleting files, installing packages, modifying production configs). Returns PASS/FAIL with score 0-100, violations, and suggestions.',
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
                    description: 'Read-only pre-flight analysis. Call BEFORE modifying 3+ interrelated files. Returns risk areas, optimal reading plan, and whether to use Phantom Workers. If it suggests parallel approaches, follow up with nexus_spawn_workers.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            goal: { type: 'string', description: 'What you want to accomplish' },
                            files: { type: 'array', items: { type: 'string' }, description: 'Relevant file paths' }
                        },
                        required: ['goal'],
                    },
                },
                {
                    name: 'nexus_spawn_workers',
                    description: 'Spawn parallel Phantom Workers when modifying 3+ interrelated files OR when Ghost Pass recommends parallel exploration. Each worker gets an isolated git worktree to independently analyze the goal. Workers sync via POD Network. Returns a synthesized merge decision with confidence score and recommended approach.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            goal: { type: 'string', description: 'The overall goal for the swarm' },
                            files: { type: 'array', items: { type: 'string' }, description: 'Files relevant to the task' }
                        },
                        required: ['goal', 'files'],
                    },
                },
                {
                    name: 'nexus_audit_evolution',
                    description: 'Identify recurring failure patterns, file hotspots, and code areas needing refactoring. Call at sprint boundaries, after major bug fixes, or when the same files keep breaking. Returns prioritized recommendations.',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                // ── Session DNA ──────────────────────────────────────────────────
                {
                    name: 'nexus_session_dna',
                    description: 'Generate or load a Session DNA snapshot. Captures files accessed/modified, decisions made, skills used, and recommended next steps for perfect session handover. Use "generate" to create a snapshot of the current session, "load" to retrieve the most recent previous session\'s DNA.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            action: { type: 'string', enum: ['generate', 'load'], description: 'Whether to generate current session DNA or load the latest previous session DNA' },
                            sessionId: { type: 'string', description: 'Optional: load a specific session by ID instead of the latest' }
                        },
                        required: ['action'],
                    },
                },
                // ── HyperTune Max ─────────────────────────────────────────────────
                {
                    name: 'nexus_hypertune_max',
                    description: 'Mathematical context-token optimization. Chunks files at function/class boundaries, scores each chunk by relevance+recency+connectivity+novelty, then selects the optimal combination via greedy knapsack that maximizes quality within the adaptive token budget. Use when you want the most token-efficient reading plan possible.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            task: { type: 'string', description: 'Task description for context scoring' },
                            files: { type: 'array', items: { type: 'string' }, description: 'File paths to optimize. If omitted, auto-scans src/' },
                        },
                        required: ['task'],
                    },
                },
                // ── Graph Query ──────────────────────────────────────────────────
                {
                    name: 'nexus_graph_query',
                    description: 'Query the knowledge graph. Actions: "query" (hybrid keyword+graph search), "traverse" (N-hop BFS from entity), "centrality" (find most connected entities), "ingest" (extract and store entities from text). Returns entities, relations, and facts.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            action: { type: 'string', enum: ['query', 'traverse', 'centrality', 'ingest'], description: 'Graph operation to perform' },
                            query: { type: 'string', description: 'Search query or entity name' },
                            depth: { type: 'number', description: 'Traversal depth (default: 2)' },
                            text: { type: 'string', description: 'Text to ingest (for action=ingest)' },
                            tags: { type: 'array', items: { type: 'string' }, description: 'Tags to associate (for action=ingest)' },
                        },
                        required: ['action'],
                    },
                },
            ],
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            if (!this.nexusRef) {
                throw new McpError(ErrorCode.InternalError, 'NexusPrime reference not set in MCP adapter.');
            }

            this.telemetry.recordCall();
            this.sessionDNA.recordToolCall();
            const result = await this.handleToolCall(request);

            // Inject telemetry footer into every response
            const memStats = this.nexusRef.memory.getStats();
            const footer = this.telemetry.format(memStats);
            if (result.content && Array.isArray(result.content) && result.content.length > 0) {
                const last = result.content[result.content.length - 1];
                if (last && typeof last === 'object' && 'text' in last) {
                    (last as any).text += footer;
                }
            }

            return result;
        });
    }

    private async handleToolCall(request: any): Promise<{ content: Array<{ type: string; text: string }> }> {
        if (!this.nexusRef) {
            throw new McpError(ErrorCode.InternalError, 'NexusPrime reference not set.');
        }

        switch (request.params.name) {

            case 'nexus_store_memory': {
                const content = String(request.params.arguments?.content ?? '');
                const priority = Number(request.params.arguments?.priority ?? 0.7);
                const tags = Array.isArray(request.params.arguments?.tags)
                    ? (request.params.arguments.tags as unknown[]).map(String)
                    : [];
                const id = this.nexusRef.storeMemory(content, priority, tags);
                nexusEventBus.emit('memory.store', { id, priority, tags, tier: priority > 0.8 ? 'cortex' : 'hippocampus' });
                this.telemetry.recordStore();
                this.sessionDNA.recordMemoryStore();
                const memStats = this.nexusRef.getMemoryStats();
                const notification = this.telemetry.notifyStore(priority, tags, memStats);
                const nudge = this.telemetry.planningNudge('store', { priority });
                return {
                    content: [{
                        type: 'text',
                        text: `✅ Stored in Nexus memory (id: ${id}, priority: ${priority})\nTags: ${tags.join(', ') || 'none'}${notification}${nudge}`,
                    }],
                };
            }

            case 'nexus_recall_memory': {
                const query = String(request.params.arguments?.query ?? '');
                const k = Number(request.params.arguments?.k ?? 5);
                const memories = await this.nexusRef.recallMemory(query, k);
                nexusEventBus.emit('memory.recall', { query, count: memories.length });
                this.telemetry.recordRecall(memories.length);
                this.sessionDNA.recordMemoryRecall();
                const memStats = this.nexusRef.getMemoryStats();
                const notification = this.telemetry.notifyRecall(memories.length, query, memStats);
                const nudge = this.telemetry.planningNudge('recall', { count: memories.length });
                return {
                    content: [{
                        type: 'text',
                        text: (memories.length > 0
                            ? `🧠 ${memories.length} memories recalled for "${query}":\n\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n\n')}`
                            : `No memories found for "${query}". Fresh session or new topic.`) + notification + nudge,
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
                const filePaths = rawFiles ?? this.scanSourceFiles(PROJECT_ROOT);

                const files: FileRef[] = filePaths.map(p => {
                    // Resolve relative paths to absolute using project root
                    const resolved = path.isAbsolute(p) ? p : path.join(PROJECT_ROOT, p);
                    try {
                        const stat = statSync(resolved);
                        return { path: resolved, sizeBytes: stat.size, lastModified: stat.mtimeMs };
                    } catch {
                        return { path: resolved, sizeBytes: 0 };
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

                this.telemetry.recordTokens(plan.savings);
                const pct = plan.totalEstimatedTokens > 0 ? Math.round(plan.savings / (plan.totalEstimatedTokens + plan.savings) * 100) : 0;
                nexusEventBus.emit('tokens.optimized', { savings: plan.savings, pct, files: filePaths.length });
                const notification = this.telemetry.notifyTokens(task, plan.savings, pct, filePaths.length);
                const fullReads = plan.files.filter((a: any) => a.action === 'full').length;
                const nudge = this.telemetry.planningNudge('optimize', { fullReads });

                return { content: [{ type: 'text', text: formatted + notification + nudge }] };
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

                nexusEventBus.emit('guardrail.check', { action: ctx.action, passed: result.passed, score: result.score });

                const nudge = result.passed
                    ? this.telemetry.planningNudge('high_call_count', {})
                    : this.telemetry.planningNudge('mindkit_fail', {});

                return {
                    content: [{
                        type: 'text', text: JSON.stringify({
                            passed: result.passed,
                            score: Math.round(result.score * 100),
                            violations: result.violations,
                            warnings: result.warnings,
                            summary: guardrailEngine.format(result)
                        }, null, 2) + nudge
                    }]
                };
            }

            case 'nexus_ghost_pass': {
                const goal = String(request.params.arguments?.goal ?? '');
                const rawFiles = Array.isArray(request.params.arguments?.files)
                    ? (request.params.arguments.files as unknown[]).map(String)
                    : [];

                const files: FileRef[] = rawFiles.map(p => {
                    const resolved = path.isAbsolute(p) ? p : path.join(PROJECT_ROOT, p);
                    try {
                        const stat = statSync(resolved);
                        return { path: resolved, sizeBytes: stat.size, lastModified: stat.mtimeMs };
                    } catch {
                        return { path: resolved, sizeBytes: 0 };
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

                nexusEventBus.emit('ghost.pass', { task: goal, risks: report.riskAreas.length, workers: report.workerAssignments.length });

                const ghostNudge = this.telemetry.planningNudge('ghost_pass', { risks: report.riskAreas.length });
                return { content: [{ type: 'text', text: text + ghostNudge }] };
            }

            case 'nexus_spawn_workers': {
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

                // Multi-process dispatch with worktree-isolated execution
                const workerPromises = report.workerAssignments.map(async (assign) => {
                    const worker = new PhantomWorker(process.cwd());
                    return worker.spawn(assign, async (worktreeDir, task, w) => {
                        const learnings: string[] = [];

                        // Read relevant files in the worktree to build context
                        for (const file of task.files.slice(0, 5)) {
                            try {
                                const fullPath = path.join(worktreeDir, file.path);
                                const content = readFileSync(fullPath, 'utf-8').slice(0, 500);
                                learnings.push(`[${task.approach}] Read ${file.path}: ${content.length} chars`);
                            } catch {
                                learnings.push(`[${task.approach}] Could not read ${file.path}`);
                            }
                        }

                        // Broadcast discovery to POD network for cross-worker learning
                        w.broadcast(
                            `Worker ${w.id} (${task.approach}): analyzed ${task.files.length} files`,
                            0.7,
                            ['#phantom-swarm', `#approach-${task.approach}`]
                        );

                        nexusEventBus.emit('phantom.worker.start', { workerId: `W-${w.id}`, approach: task.approach, goal });

                        // Check what other workers found
                        const peerFindings = w.receive(['#phantom-swarm']);
                        if (peerFindings.length > 0) {
                            learnings.push(`Received ${peerFindings.length} findings from peer workers`);
                        }

                        const confidence = learnings.length > 0 ? 0.75 : 0.5;
                        nexusEventBus.emit('phantom.worker.complete', { workerId: `W-${w.id}`, confidence });

                        return {
                            learnings,
                            confidence,
                        };
                    });
                });

                const results = await Promise.all(workerPromises);

                // Synthesis
                const oracle = new MergeOracle(this.nexusRef!.memory);
                const decision = await oracle.merge(results);

                this.nexusRef.storeMemory(
                    `Phantom Swarm executed: ${results.length} workers, action=${decision.action}, confidence=${decision.confidence.toFixed(2)}`,
                    0.8, ['#phantom-swarm', '#decision']
                );

                nexusEventBus.emit('phantom.merge', { action: decision.action, winner: decision.recommendedStrategy });

                // NEW: Agent Learning Loop
                await this.nexusRef.analyzeLearning(goal, decision);

                return {
                    content: [{
                        type: 'text',
                        text: [
                            `🐝 Phantom Swarm Complete — ${results.length} workers synchronized.`,
                            '',
                            `🎯 Goal: ${goal}`,
                            '',
                            `🧩 Synthesized Decision:`,
                            decision.synthesized || 'No changes made.',
                            '',
                            `📝 Conflicts: ${decision.conflicts.length > 0 ? decision.conflicts.join(', ') : 'None'}`,
                            `📈 Strategy: ${decision.recommendedStrategy}`
                        ].join('\n')
                    }]
                };
            }

            case 'nexus_audit_evolution': {
                const { candidates, hotspots, recommendations } = await this.nexusRef!.auditEvolution();

                const lines: string[] = ['🧬 Evolution Audit Report', ''];

                // Recommendations first (most actionable)
                if (recommendations.length > 0) {
                    lines.push('## Recommendations');
                    for (const rec of recommendations) lines.push(`  ${rec}`);
                    lines.push('');
                }

                // Hotspots
                if (hotspots.size > 0) {
                    lines.push('## File Hotspots (conflict frequency)');
                    for (const [file, count] of [...hotspots.entries()].sort((a, b) => b[1] - a[1])) {
                        lines.push(`  ${count}x  ${file}`);
                    }
                    lines.push('');
                }

                // Raw candidates count
                lines.push(`📊 ${candidates.length} evolution candidate(s) in memory.`);

                return {
                    content: [{ type: 'text', text: lines.join('\n') }]
                };
            }

            case 'nexus_graph_query': {
                const action = String(request.params.arguments?.action ?? 'query');
                const query = String(request.params.arguments?.query ?? '');
                const depth = Number(request.params.arguments?.depth ?? 2);

                switch (action) {
                    case 'query': {
                        const retriever = getHybridRetriever();
                        const result = await retriever.retrieve(query, 10, depth);
                        const formatted = HybridRetriever.format(result);
                        return { content: [{ type: 'text', text: formatted }] };
                    }
                    case 'traverse': {
                        const traversal = getTraversalEngine();
                        const result = traversal.queryByName(query, depth);
                        const formatted = GraphTraversalEngine.format(result);
                        return { content: [{ type: 'text', text: formatted }] };
                    }
                    case 'centrality': {
                        const traversal = getTraversalEngine();
                        const scores = traversal.computeCentrality(20);
                        if (scores.length === 0) {
                            return { content: [{ type: 'text', text: '📭 No entities in graph yet.' }] };
                        }
                        const lines = ['📊 Entity Centrality (top 20):', ''];
                        for (const s of scores) {
                            lines.push(`  • ${s.entityName} — score: ${s.score.toFixed(3)} (in: ${s.inDegree}, out: ${s.outDegree})`);
                        }
                        return { content: [{ type: 'text', text: lines.join('\n') }] };
                    }
                    case 'ingest': {
                        const text = String(request.params.arguments?.text ?? '');
                        const tags = Array.isArray(request.params.arguments?.tags)
                            ? (request.params.arguments.tags as unknown[]).map(String) : [];
                        const graph = getGraphEngine();
                        const { entities, relations } = graph.ingestFromText(text, tags);
                        return {
                            content: [{
                                type: 'text',
                                text: `✅ Ingested: ${entities.length} entities, ${relations.length} relations extracted and stored in graph.`,
                            }],
                        };
                    }
                    default:
                        return { content: [{ type: 'text', text: `Unknown graph action: ${action}` }] };
                }
            }

            case 'nexus_hypertune_max': {
                const task = String(request.params.arguments?.task ?? '');
                const rawFiles = Array.isArray(request.params.arguments?.files)
                    ? (request.params.arguments.files as unknown[]).map(String)
                    : null;
                const filePaths = rawFiles ?? this.scanSourceFiles(PROJECT_ROOT);

                const files: FileRef[] = filePaths.map(p => {
                    const resolved = path.isAbsolute(p) ? p : path.join(PROJECT_ROOT, p);
                    try {
                        const stat = statSync(resolved);
                        return { path: resolved, sizeBytes: stat.size, lastModified: stat.mtimeMs };
                    } catch {
                        return { path: resolved, sizeBytes: 0 };
                    }
                }).filter(f => f.sizeBytes > 0);

                const { plan, assembly, budgetConfig } = tokenEngine.hypertuneMax(task, files);
                const planText = formatReadingPlan(plan);
                const assemblyText = ContextAssembler.format(assembly, budgetConfig);

                const savings = plan.savings;
                const pct = plan.totalEstimatedTokens + savings > 0
                    ? Math.round((savings / (plan.totalEstimatedTokens + savings)) * 100)
                    : 0;
                this.telemetry.recordTokens(savings);
                nexusEventBus.emit('tokens.optimized', { savings, pct, files: files.length });

                const notification = this.telemetry.notifyTokens(task, savings, pct, files.length);
                const nudge = this.telemetry.planningNudge('optimize', { savings, pct });

                return {
                    content: [{
                        type: 'text',
                        text: `${assemblyText}\n\n${planText}${notification}${nudge}`,
                    }],
                };
            }

            case 'nexus_session_dna': {
                const action = String(request.params.arguments?.action ?? 'load');
                const sessionId = request.params.arguments?.sessionId
                    ? String(request.params.arguments.sessionId)
                    : undefined;

                if (action === 'generate') {
                    // Sync counters from telemetry before generating
                    this.sessionDNA.syncFromTelemetry({
                        callCount: (this.telemetry as any).callCount ?? 0,
                        memoriesStored: (this.telemetry as any).memoriesStored ?? 0,
                        memoriesRecalled: (this.telemetry as any).memoriesRecalled ?? 0,
                    });
                    const dna = this.sessionDNA.flush();
                    const formatted = SessionDNAManager.format(dna);
                    return {
                        content: [{
                            type: 'text',
                            text: `✅ Session DNA generated and saved.\n\n${formatted}`,
                        }],
                    };
                } else {
                    // Load latest or by ID
                    const dna = sessionId
                        ? SessionDNAManager.loadById(sessionId)
                        : SessionDNAManager.loadLatest();
                    if (!dna) {
                        return {
                            content: [{
                                type: 'text',
                                text: '📭 No previous Session DNA found. This appears to be a fresh start.',
                            }],
                        };
                    }
                    const formatted = SessionDNAManager.format(dna);
                    return {
                        content: [{
                            type: 'text',
                            text: `📦 Previous Session DNA loaded:\n\n${formatted}`,
                        }],
                    };
                }
            }

            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
        }
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
        console.error('[MCP Adapter] Connected — 11 tools active');
    }

    async disconnect(): Promise<void> {
        // Auto-flush Session DNA on disconnect
        try {
            this.sessionDNA.syncFromTelemetry({
                callCount: (this.telemetry as any).callCount ?? 0,
                memoriesStored: (this.telemetry as any).memoriesStored ?? 0,
                memoriesRecalled: (this.telemetry as any).memoriesRecalled ?? 0,
            });
            this.sessionDNA.flush();
            console.error('[MCP Adapter] Session DNA flushed');
        } catch (e) {
            console.error('[MCP Adapter] Failed to flush Session DNA:', e);
        }
        await this.server.close();
        this.connected = false;
        console.error('[MCP Adapter] Disconnected');
    }

    async send(_message: NetworkMessage): Promise<void> { /* future */ }
    receive(_message: NetworkMessage): void { /* future */ }
}
