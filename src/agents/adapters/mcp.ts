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
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { Adapter, NetworkMessage } from '../core/types.js';
import { NexusPrime } from '../../index.js';
import {
    TokenSupremacyEngine,
    formatReadingPlan,
    type FileRef
} from '../../engines/token-supremacy.js';
import {
    GhostPass,
    createSubAgentRuntime,
    summarizeExecution,
    type SubAgentRuntime,
} from '../../phantom/index.js';
import { GuardrailEngine } from '../../engines/guardrails-bridge.js';
import { SessionDNAManager } from '../../engines/session-dna.js';
import { ContextAssembler } from '../../engines/context-assembler.js';
import { GraphMemoryEngine } from '../../engines/graph-memory.js';
import { GraphTraversalEngine } from '../../engines/graph-traversal.js';
import { HybridRetriever } from '../../engines/hybrid-retriever.js';
import { nexusEventBus } from '../../engines/event-bus.js';
import { AttentionScorer } from '../../engines/attention-stream.js';
import { SkillCardRegistry, type SkillCard } from '../../engines/skill-card.js';
import type { HookTrigger } from '../../engines/runtime-assets.js';
import { DarwinLoop } from '../../engines/darwin-loop.js';
import { nexusNetRelay } from '../../engines/nexusnet-relay.js';
import {
    entanglementEngine,
    ContinuousAttentionStream,
    createKVBridge,
    nxl,
    OrchestratorEngine
} from '../../engines/index.js';
import { FederationEngine, type TraceEntry } from '../../engines/federation.js';

const tokenEngine = new TokenSupremacyEngine();
const guardrailEngine = new GuardrailEngine();
const darwinLoop = new DarwinLoop();
const casEngine = new ContinuousAttentionStream();
const kvBridge = createKVBridge({ agents: 3 });
const orchestrator = new OrchestratorEngine();
const federation = new FederationEngine();
const fallbackRuntime = createSubAgentRuntime({ repoRoot: process.cwd() });

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

type McpToolProfile = 'autonomous' | 'full';
type McpToolDefinition = {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
};

const AUTONOMOUS_TOOL_ORDER = [
    'nexus_session_bootstrap',
    'nexus_orchestrate',
    'nexus_plan_execution',
    'nexus_recall_memory',
    'nexus_memory_stats',
    'nexus_store_memory',
    'nexus_optimize_tokens',
    'nexus_mindkit_check',
    'nexus_ghost_pass',
    'nexus_spawn_workers',
    'nexus_session_dna',
    'nexus_list_skills',
    'nexus_list_workflows',
    'nexus_list_hooks',
    'nexus_list_automations',
    'nexus_list_specialists',
    'nexus_list_crews',
    'nexus_federation_status',
    'nexus_run_status',
] as const;

const AUTONOMOUS_TOOL_SET = new Set<string>(AUTONOMOUS_TOOL_ORDER);
const MANUAL_OR_DIAGNOSTIC_TOOLS = new Set<string>([
    'nexus_spawn_workers',
    'nexus_optimize_tokens',
    'nexus_ghost_pass',
    'nexus_hypertune_max',
    'nexus_graph_query',
    'nexus_skill_generate',
    'nexus_skill_deploy',
    'nexus_skill_revoke',
    'nexus_workflow_generate',
    'nexus_workflow_deploy',
    'nexus_workflow_run',
    'nexus_hook_generate',
    'nexus_hook_deploy',
    'nexus_hook_revoke',
    'nexus_automation_generate',
    'nexus_automation_deploy',
    'nexus_automation_run',
    'nexus_automation_revoke',
    'nexus_memory_audit',
    'nexus_memory_export',
    'nexus_memory_import',
    'nexus_memory_backup',
    'nexus_memory_maintain',
    'nexus_memory_trace',
    'nexus_darwin_propose',
    'nexus_darwin_review',
    'nexus_net_publish',
    'nexus_net_sync',
    'nexus_entangle',
    'nexus_cas_compress',
    'nexus_kv_bridge_status',
    'nexus_kv_adapt',
    'nexus_decompose_task',
    'nexus_request_affirmation',
    'nexus_assemble_context',
    'nexus_execute_nxl',
    'nexus_publish_trace',
    'nexus_rag_list_collections',
    'nexus_rag_create_collection',
    'nexus_rag_ingest_collection',
    'nexus_rag_attach_collection',
    'nexus_rag_detach_collection',
    'nexus_rag_delete_collection',
    'nexus_pattern_search',
    'nexus_pattern_list',
    'nexus_knowledge_provenance',
]);

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

    notifyStore(priority: number, tags: string[], memStats: { cortex: number; totalLinks: number }): string {
        return `\nMemory telemetry: priority ${priority.toFixed(2)} · tags ${tags.join(', ') || 'none'} · cortex ${memStats.cortex} · zettel ${memStats.totalLinks}`;
    }

    notifyRecall(count: number, query: string, memStats: { hippocampus: number; cortex: number }): string {
        return `\nMemory telemetry: ${count} recalled · query "${query.slice(0, 28)}" · hippocampus ${memStats.hippocampus}/200 · cortex ${memStats.cortex}`;
    }

    notifyTokens(task: string, savings: number, pct: number, fileCount: number): string {
        return `\nToken telemetry: saved ${savings.toLocaleString()} (${pct}%) across ${fileCount} files · lifetime saved ${(this.tokensOptimized / 1000).toFixed(1)}k`;
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
            memStats ? `${memStats.totalLinks} Zettel links` : null,
        ].filter(Boolean);
        return `\nSession telemetry (${uptimeStr}): ${parts.join(' · ')}`;
    }
}

function formatBullets(lines: Array<string | null | undefined>): string {
    return lines.filter(Boolean).map((line) => `- ${line}`).join('\n');
}

function formatJsonDetails(label: string, value: unknown): string {
    return `\n\n${label}\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

export class MCPAdapter implements Adapter {
    name: string;
    type = 'mcp' as const;
    connected = false;
    agents: string[] = [];

    private server: Server;
    private nexusRef?: NexusPrime;
    private telemetry: SessionTelemetry = new SessionTelemetry();
    private sessionDNA: SessionDNAManager;
    private runtime?: SubAgentRuntime;

    private box(title: string, content: string[], color: string = '34'): void {
        const width = 68;
        console.error(`\n\x1b[${color}m┌─ ${title} ${'─'.repeat(Math.max(0, width - title.length - 4))}┐\x1b[0m`);
        content.forEach(line => {
            console.error(`\x1b[${color}m│\x1b[0m ${line.substring(0, width - 2).padEnd(width - 2, ' ')} \x1b[${color}m│\x1b[0m`);
        });
        console.error(`\x1b[${color}m└${'─'.repeat(width)}┘\x1b[0m\n`);
    }

    constructor() {
        this.name = this.detectCallerName();
        this.server = new Server(
            { name: 'nexus-prime-mcp', version: '0.4.0' },
            { capabilities: { tools: {} } }
        );
        this.sessionDNA = new SessionDNAManager(crypto.randomUUID?.() ?? `session-${Date.now()}`);
        this.setupToolHandlers();
    }

    private detectCallerName(): string {
        // Check well-known environment variables set by MCP clients
        if (process.env.CLAUDE_CODE || process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_PROJECT_DIR) return 'claude-code';
        if (process.env.CODEX_HOME || process.env.CODEX_SESSION) return 'codex';
        if (process.env.CURSOR_HOME || process.env.CURSOR_SESSION) return 'cursor';
        if (process.env.OPENCODE_HOME) return 'opencode';
        if (process.env.WINDSURF_HOME || process.env.WINDSURF_SESSION) return 'windsurf';
        if (process.env.MCP_CLIENT_NAME) return process.env.MCP_CLIENT_NAME.toLowerCase();

        // Check parent process name as fallback
        try {
            const ppid = process.ppid;
            if (ppid) {
                const ps = execSync(`ps -p ${ppid} -o comm=`, { encoding: 'utf8', timeout: 400 }).trim().toLowerCase();
                if (ps.includes('claude')) return 'claude-code';
                if (ps.includes('codex')) return 'codex';
                if (ps.includes('cursor')) return 'cursor';
                if (ps.includes('opencode')) return 'opencode';
                if (ps.includes('windsurf')) return 'windsurf';
                if (ps.includes('antigravity') || ps.includes('openclaw')) return 'openclaw';
            }
        } catch {
            // ignore — ps may not be available
        }

        return 'mcp';
    }

    setNexusRef(nexus: NexusPrime) {
        this.nexusRef = nexus;
    }

    private getRuntime(): SubAgentRuntime {
        if (this.nexusRef && typeof this.nexusRef.getRuntime === 'function') {
            return this.nexusRef.getRuntime();
        }

        if (!this.runtime) {
            this.runtime = fallbackRuntime;
        }

        return this.runtime;
    }

    private getOrchestrator(): OrchestratorEngine {
        if (this.nexusRef && typeof this.nexusRef.getOrchestrator === 'function') {
            return this.nexusRef.getOrchestrator();
        }
        return orchestrator;
    }

    private getToolProfile(): McpToolProfile {
        return String(process.env.NEXUS_MCP_TOOL_PROFILE ?? 'autonomous').toLowerCase() === 'full'
            ? 'full'
            : 'autonomous';
    }

    private describeClientInstructionStatus(profile: McpToolProfile): string {
        return profile === 'autonomous'
            ? 'Autonomous MCP profile active. Prefer nexus_session_bootstrap then nexus_orchestrate.'
            : 'Full MCP profile active. Low-level and authoring tools are exposed.';
    }

    private finalizeToolDefinitions(tools: McpToolDefinition[], profile: McpToolProfile = this.getToolProfile()): McpToolDefinition[] {
        const scoped = profile === 'full'
            ? tools.slice()
            : tools.filter((tool) => AUTONOMOUS_TOOL_SET.has(tool.name));
        const order = profile === 'full'
            ? [...AUTONOMOUS_TOOL_ORDER, ...scoped.map((tool) => tool.name).filter((name) => !AUTONOMOUS_TOOL_SET.has(name))]
            : [...AUTONOMOUS_TOOL_ORDER];
        const orderIndex = new Map(order.map((name, index) => [name, index]));

        return scoped
            .map((tool) => ({
                ...tool,
                description: this.decorateToolDescription(tool.name, tool.description, profile),
            }))
            .sort((left, right) => {
                const leftIndex = orderIndex.get(left.name) ?? Number.MAX_SAFE_INTEGER;
                const rightIndex = orderIndex.get(right.name) ?? Number.MAX_SAFE_INTEGER;
                return leftIndex - rightIndex || left.name.localeCompare(right.name);
            });
    }

    private decorateToolDescription(name: string, description: string, profile: McpToolProfile): string {
        if (name === 'nexus_session_bootstrap') {
            return 'Preferred session-start tool for external clients. Call this first to recover memory, inspect stats, see the recommended next step, and learn whether token optimization will be applied before execution.';
        }
        if (name === 'nexus_orchestrate') {
            return 'Preferred default for non-trivial work. Give Nexus Prime the raw request and let it choose crews, specialists, skills, workflows, hooks, automations, and token strategy automatically.';
        }
        if (name === 'nexus_plan_execution') {
            return 'Optional plan-before-run surface. Use only when you explicitly want to inspect the execution ledger before calling nexus_orchestrate.';
        }
        if (name === 'nexus_optimize_tokens') {
            return 'Manual/diagnostic reading-plan tool. Usually the orchestrator applies token optimization internally; call this directly only when you need to inspect or override the reading plan.';
        }
        if (name === 'nexus_spawn_workers') {
            return 'Manual/diagnostic swarm surface. Prefer nexus_orchestrate unless you explicitly want low-level control over worker count, strategies, or runtime actions.';
        }
        if (MANUAL_OR_DIAGNOSTIC_TOOLS.has(name) && profile === 'full') {
            return `Advanced/manual surface. ${description}`;
        }
        return description;
    }

    debugListTools(profile: McpToolProfile = this.getToolProfile()): McpToolDefinition[] {
        return this.finalizeToolDefinitions(this.buildToolDefinitions(), profile);
    }

    private buildToolDefinitions(): McpToolDefinition[] {
        return [
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
                // ── Memory ────────────────────────────────────────────────────────
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
                    description: 'Get deep stats about the Graph Knowledge Engine: tier counts, top tags, and Zettelkasten links. Use this to gauge available knowledge depth before starting research.',
                    inputSchema: { type: 'object', properties: {}, required: [] },
                },
                {
                    name: 'nexus_memory_export',
                    description: 'Expert surface: export a portable Nexus memory bundle by scope/state/session.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            limit: { type: 'number', description: 'Optional maximum exported items' },
                            scope: { type: 'string', enum: ['session', 'project', 'user', 'promoted', 'shared'], description: 'Optional memory scope filter' },
                            state: { type: 'string', enum: ['active', 'quarantined', 'scrap'], description: 'Optional memory state filter' },
                            sessionId: { type: 'string', description: 'Optional session filter' },
                        },
                        required: [],
                    },
                },
                {
                    name: 'nexus_memory_backup',
                    description: 'Expert surface: export a portable memory bundle and persist it to the Nexus memory vault exports directory.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            limit: { type: 'number', description: 'Optional maximum exported items' },
                            scope: { type: 'string', enum: ['session', 'project', 'user', 'promoted', 'shared'], description: 'Optional memory scope filter' },
                            state: { type: 'string', enum: ['active', 'quarantined', 'scrap'], description: 'Optional memory state filter' },
                            sessionId: { type: 'string', description: 'Optional session filter' },
                        },
                        required: [],
                    },
                },
                {
                    name: 'nexus_memory_import',
                    description: 'Expert surface: import a previously exported portable memory bundle into Nexus memory.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'Absolute path to a previously exported memory bundle' },
                            bundle: { type: 'object', description: 'Inline memory bundle payload when importing programmatically' },
                        },
                        required: [],
                    },
                },
                {
                    name: 'nexus_memory_maintain',
                    description: 'Expert surface: run memory maintenance to expire TTL memories, cool stale entries, and quarantine or scrap low-signal items.',
                    inputSchema: { type: 'object', properties: {}, required: [] },
                },
                {
                    name: 'nexus_memory_trace',
                    description: 'Expert surface: inspect one memory item with lineage, backlinks, and reconciliation details.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'Memory ID to inspect' },
                        },
                        required: ['id'],
                    },
                },
                {
                    name: 'nexus_session_bootstrap',
                    description: 'Read-only session-start summary. Returns current client identity, memory recall summary, memory stats, recommended next step, recommended execution mode, shortlist recommendations, and whether token optimization will be required.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            goal: { type: 'string', description: 'Raw goal or task description for this session' },
                            files: { type: 'array', items: { type: 'string' }, description: 'Optional candidate file constraints' },
                        },
                        required: ['goal'],
                    },
                },
                // ── Token optimization ────────────────────────────────────────────
                {
                    name: 'nexus_orchestrate',
                    description: 'Primary raw-prompt entrypoint. Let Nexus Prime classify intent, recall memory, plan, choose crews/specialists/skills/workflows/hooks/automations, optimize tokens, and execute a bounded autonomous run.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            prompt: { type: 'string', description: 'Raw prompt or objective to orchestrate end-to-end' },
                            files: { type: 'array', items: { type: 'string' }, description: 'Optional hard constraints for candidate files' },
                            workers: { type: 'number', description: 'Optional worker override' },
                            skills: { type: 'array', items: { type: 'string' }, description: 'Optional hard skill selectors' },
                            workflows: { type: 'array', items: { type: 'string' }, description: 'Optional hard workflow selectors' },
                            hooks: { type: 'array', items: { type: 'string' }, description: 'Optional hard hook selectors' },
                            automations: { type: 'array', items: { type: 'string' }, description: 'Optional hard automation selectors' },
                            crews: { type: 'array', items: { type: 'string' }, description: 'Optional hard crew selectors' },
                            specialists: { type: 'array', items: { type: 'string' }, description: 'Optional hard specialist selectors' },
                            optimizationProfile: { type: 'string', enum: ['standard', 'max'], description: 'Planner optimization profile override' }
                        },
                        required: ['prompt'],
                    },
                },
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
                    description: 'Spawn parallel Phantom Workers when modifying 3+ interrelated files OR when Ghost Pass recommends parallel exploration. Each worker gets an isolated git worktree to execute actions, run verification, and return artifacts. The runtime applies merge consensus and reports the final decision truthfully.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            goal: { type: 'string', description: 'The overall goal for the swarm' },
                            files: { type: 'array', items: { type: 'string' }, description: 'Files relevant to the task' },
                            workers: { type: 'number', description: 'Number of phantom workers to spawn (max 7)', default: 3 },
                            verify: { type: 'array', items: { type: 'string' }, description: 'Verification commands to run in verifier worktrees' },
                            strategies: { type: 'array', items: { type: 'string' }, description: 'Optional worker strategies such as minimal, standard, thorough' },
                            actions: { type: 'array', items: { type: 'object' }, description: 'Optional runtime actions or skill bindings to execute in worker worktrees' },
                            skills: { type: 'array', items: { type: 'string' }, description: 'Runtime skill selectors' },
                            workflows: { type: 'array', items: { type: 'string' }, description: 'Workflow selectors' },
                            crews: { type: 'array', items: { type: 'string' }, description: 'Crew selectors' },
                            specialists: { type: 'array', items: { type: 'string' }, description: 'Specialist selectors' },
                            memoryBackend: { type: 'string', description: 'Memory backend selector' },
                            compressionBackend: { type: 'string', description: 'Compression backend selector' },
                            dslCompiler: { type: 'string', description: 'DSL compiler selector' },
                            backendMode: { type: 'string', enum: ['default', 'shadow', 'experimental'], description: 'Backend execution mode' },
                            optimizationProfile: { type: 'string', enum: ['standard', 'max'], description: 'Planner optimization profile' },
                        },
                        required: ['goal', 'files'],
                    },
                },
                {
                    name: 'nexus_plan_execution',
                    description: 'Run the additive task planner without executing mutations. Returns selected crew, specialists, skills, tools, fallback plan, and review gates.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            goal: { type: 'string', description: 'The overall goal to plan' },
                            files: { type: 'array', items: { type: 'string' }, description: 'Optional focused files' },
                            skills: { type: 'array', items: { type: 'string' }, description: 'Optional skill selectors' },
                            workflows: { type: 'array', items: { type: 'string' }, description: 'Optional workflow selectors' },
                            crews: { type: 'array', items: { type: 'string' }, description: 'Optional crew selectors' },
                            specialists: { type: 'array', items: { type: 'string' }, description: 'Optional specialist selectors' },
                            optimizationProfile: { type: 'string', enum: ['standard', 'max'], description: 'Planner optimization profile' }
                        },
                        required: ['goal'],
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
                // ── Skill Cards ──────────────────────────────────────────────────
                {
                    name: 'nexus_list_skills',
                    description: 'List runtime skills available to the orchestrator and planner, including scope, status, and concise instructions.',
                    inputSchema: { type: 'object', properties: {}, required: [] },
                },
                {
                    name: 'nexus_skill_register',
                    description: 'Register a declarative Skill Card into the Graph Knowledge Engine. Skill cards define contextual triggers and reusable tool execution templates without using arbitrary eval().',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            card: {
                                type: 'object',
                                description: 'The SkillCard object containing name, trigger DSL, actions, confidence, origin, and adoptions.',
                            }
                        },
                        required: ['card'],
                    },
                },
                {
                    name: 'nexus_skill_generate',
                    description: 'Generate a live runtime skill artifact that can be deployed to future runs or promoted after evidence-backed execution.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Skill name' },
                            instructions: { type: 'string', description: 'Instructions for the generated skill' },
                            riskClass: { type: 'string', enum: ['read', 'orchestrate', 'mutate'], description: 'Risk class for the skill' },
                            scope: { type: 'string', enum: ['session', 'worker', 'global'], description: 'Initial scope for the skill' }
                        },
                        required: ['name', 'instructions'],
                    },
                },
                {
                    name: 'nexus_skill_deploy',
                    description: 'Promote or deploy a live runtime skill artifact so future runs can activate it.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            skillId: { type: 'string', description: 'Skill artifact ID or exact name' },
                            scope: { type: 'string', enum: ['session', 'worker', 'global'], description: 'Deployment scope' }
                        },
                        required: ['skillId'],
                    },
                },
                {
                    name: 'nexus_skill_revoke',
                    description: 'Revoke a live runtime skill artifact.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            skillId: { type: 'string', description: 'Skill artifact ID or exact name' }
                        },
                        required: ['skillId'],
                    },
                },
                {
                    name: 'nexus_list_workflows',
                    description: 'List runtime workflows available to the orchestrator and planner, including scope, status, and intended domain.',
                    inputSchema: { type: 'object', properties: {}, required: [] },
                },
                {
                    name: 'nexus_workflow_generate',
                    description: 'Generate a workflow artifact that can be deployed to runs or promoted through runtime evidence.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Workflow name' },
                            description: { type: 'string', description: 'Workflow description' },
                            domain: { type: 'string', description: 'Optional workflow domain' },
                            scope: { type: 'string', enum: ['session', 'worker', 'global'], description: 'Initial workflow scope' }
                        },
                        required: ['name', 'description'],
                    },
                },
                {
                    name: 'nexus_workflow_deploy',
                    description: 'Deploy or promote a workflow artifact for future runs.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            workflowId: { type: 'string', description: 'Workflow artifact ID or exact name' },
                            scope: { type: 'string', enum: ['session', 'worker', 'global'], description: 'Deployment scope' }
                        },
                        required: ['workflowId'],
                    },
                },
                {
                    name: 'nexus_workflow_run',
                    description: 'Run a workflow artifact through the real execution runtime.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            workflowId: { type: 'string', description: 'Workflow artifact ID or exact name' },
                            goal: { type: 'string', description: 'Optional override goal' }
                        },
                        required: ['workflowId'],
                    },
                },
                {
                    name: 'nexus_list_hooks',
                    description: 'List runtime hooks available to the orchestrator, including trigger, scope, rollout state, and effect summary.',
                    inputSchema: { type: 'object', properties: {}, required: [] },
                },
                {
                    name: 'nexus_hook_generate',
                    description: 'Generate a runtime hook artifact for checkpoint and system-event execution.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Hook name' },
                            description: { type: 'string', description: 'Hook description' },
                            trigger: { type: 'string', enum: ['run.created', 'before-read', 'before-mutate', 'before-verify', 'retry', 'run.failed', 'run.verified', 'promotion.approved', 'memory.stored', 'shield.blocked'], description: 'Hook trigger' },
                            riskClass: { type: 'string', enum: ['read', 'orchestrate', 'mutate'], description: 'Risk class for the hook' },
                            scope: { type: 'string', enum: ['session', 'worker', 'global'], description: 'Initial hook scope' }
                        },
                        required: ['name', 'description', 'trigger'],
                    },
                },
                {
                    name: 'nexus_hook_deploy',
                    description: 'Deploy or promote a hook artifact for future runs.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            hookId: { type: 'string', description: 'Hook artifact ID or exact name' },
                            scope: { type: 'string', enum: ['session', 'worker', 'global'], description: 'Deployment scope' }
                        },
                        required: ['hookId'],
                    },
                },
                {
                    name: 'nexus_hook_revoke',
                    description: 'Revoke a runtime hook artifact.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            hookId: { type: 'string', description: 'Hook artifact ID or exact name' }
                        },
                        required: ['hookId'],
                    },
                },
                {
                    name: 'nexus_list_automations',
                    description: 'List runtime automations available to the orchestrator, including trigger mode, scope, rollout state, and queued-run behavior.',
                    inputSchema: { type: 'object', properties: {}, required: [] },
                },
                {
                    name: 'nexus_automation_generate',
                    description: 'Generate a runtime automation artifact for event, schedule, or connector triggers.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Automation name' },
                            description: { type: 'string', description: 'Automation description' },
                            triggerMode: { type: 'string', enum: ['event', 'schedule', 'connector'], description: 'Trigger mode' },
                            eventTrigger: { type: 'string', enum: ['run.created', 'before-read', 'before-mutate', 'before-verify', 'retry', 'run.failed', 'run.verified', 'promotion.approved', 'memory.stored', 'shield.blocked'], description: 'Event trigger when triggerMode=event' },
                            scope: { type: 'string', enum: ['session', 'worker', 'global'], description: 'Initial automation scope' }
                        },
                        required: ['name', 'description'],
                    },
                },
                {
                    name: 'nexus_automation_deploy',
                    description: 'Deploy or promote an automation artifact.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            automationId: { type: 'string', description: 'Automation artifact ID or exact name' },
                            scope: { type: 'string', enum: ['session', 'worker', 'global'], description: 'Deployment scope' }
                        },
                        required: ['automationId'],
                    },
                },
                {
                    name: 'nexus_automation_run',
                    description: 'Run an automation artifact through the real execution runtime.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            automationId: { type: 'string', description: 'Automation artifact ID or exact name' },
                            goal: { type: 'string', description: 'Optional override goal' }
                        },
                        required: ['automationId'],
                    },
                },
                {
                    name: 'nexus_automation_revoke',
                    description: 'Revoke a runtime automation artifact.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            automationId: { type: 'string', description: 'Automation artifact ID or exact name' }
                        },
                        required: ['automationId'],
                    },
                },
                {
                    name: 'nexus_memory_audit',
                    description: 'Audit stored memories for duplicates, contradictions, quarantine candidates, and promotion safety.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            limit: { type: 'number', description: 'Maximum memories to scan' }
                        },
                    },
                },
                {
                    name: 'nexus_federation_status',
                    description: 'Return local federation status, peer inventory, relay learnings, and active peer links.',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                {
                    name: 'nexus_list_specialists',
                    description: 'List the built-in imported specialist roster available to the planner and runtime.',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                {
                    name: 'nexus_list_crews',
                    description: 'List the preset crews available to the planner and runtime.',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                {
                    name: 'nexus_rag_list_collections',
                    description: 'Expert surface: list session-first RAG collections managed by Nexus Prime.',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                {
                    name: 'nexus_rag_create_collection',
                    description: 'Expert surface: create a session-first RAG collection outside the git repo.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Collection name' },
                            description: { type: 'string', description: 'Optional collection description' },
                            tags: { type: 'array', items: { type: 'string' }, description: 'Collection tags' },
                            scope: { type: 'string', enum: ['session', 'project'], description: 'Collection scope' },
                        },
                        required: ['name'],
                    },
                },
                {
                    name: 'nexus_rag_ingest_collection',
                    description: 'Expert surface: ingest local files, URLs, or raw text into a RAG collection.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            collectionId: { type: 'string', description: 'Collection id' },
                            inputs: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        filePath: { type: 'string' },
                                        url: { type: 'string' },
                                        text: { type: 'string' },
                                        label: { type: 'string' },
                                        tags: { type: 'array', items: { type: 'string' } },
                                    },
                                },
                                description: 'Collection sources',
                            },
                        },
                        required: ['collectionId', 'inputs'],
                    },
                },
                {
                    name: 'nexus_rag_attach_collection',
                    description: 'Expert surface: attach an existing RAG collection to the active runtime/session.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            collectionId: { type: 'string', description: 'Collection id' },
                        },
                        required: ['collectionId'],
                    },
                },
                {
                    name: 'nexus_rag_detach_collection',
                    description: 'Expert surface: detach a RAG collection from the active runtime/session.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            collectionId: { type: 'string', description: 'Collection id' },
                        },
                        required: ['collectionId'],
                    },
                },
                {
                    name: 'nexus_rag_delete_collection',
                    description: 'Expert surface: delete a RAG collection from Nexus state.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            collectionId: { type: 'string', description: 'Collection id' },
                        },
                        required: ['collectionId'],
                    },
                },
                {
                    name: 'nexus_pattern_search',
                    description: 'Expert surface: search bounded orchestration pattern cards that can shape a run.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'Pattern search query' },
                            limit: { type: 'number', description: 'Optional result limit' },
                        },
                        required: ['query'],
                    },
                },
                {
                    name: 'nexus_pattern_list',
                    description: 'Expert surface: list the top bounded orchestration pattern cards available to Nexus Prime.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            limit: { type: 'number', description: 'Optional result limit' },
                        },
                    },
                },
                {
                    name: 'nexus_knowledge_provenance',
                    description: 'Expert surface: inspect the latest knowledge-fabric provenance trace for the active runtime.',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                {
                    name: 'nexus_run_status',
                    description: 'Return the current recorded state of a runtime execution run.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            runId: { type: 'string', description: 'Execution run ID' }
                        },
                        required: ['runId'],
                    },
                },
                // ── Darwin Loop ──────────────────────────────────────────────────
                {
                    name: 'nexus_darwin_propose',
                    description: 'Propose a self-improvement cycle for Nexus Prime. Forces validation against the Bounded Improvement Space (forbidding core changes). Use when you have a specific hypothesis to improve an engine or phantom worker.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            hypothesis: { type: 'string', description: 'What you are trying to improve and why' },
                            targetFile: { type: 'string', description: 'The specific file you want to change (must be in src/engines/ or src/phantom/)' },
                            approach: { type: 'string', description: 'How you plan to implement it' }
                        },
                        required: ['hypothesis', 'targetFile', 'approach'],
                    },
                },
                {
                    name: 'nexus_darwin_review',
                    description: 'Review and finalize a pending Darwin Cycle after validation.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cycleId: { type: 'string', description: 'ID of the pending Darwin Cycle' },
                            action: { type: 'string', enum: ['apply', 'reject', 'defer'], description: 'Outcome of the review' },
                            learnings: { type: 'array', items: { type: 'string' }, description: 'Lessons learned from attempting this cycle' }
                        },
                        required: ['cycleId', 'action'],
                    },
                },
                // ── NexusNet Relay ───────────────────────────────────────────────
                {
                    name: 'nexus_net_publish',
                    description: 'Publish an anonymized knowledge snippet or SkillCard to the shared NexusNet relay (MVP via GitHub Gists). Use this to share valuable insights or templates with other agents across machines.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: ['knowledge', 'skill'], description: 'Type of content' },
                            content: { type: 'string', description: 'The knowledge string or SkillCard YAML to share' },
                            tags: { type: 'array', items: { type: 'string' }, description: 'Tags to associate with this message' }
                        },
                        required: ['type', 'content', 'tags'],
                    },
                },
                {
                    name: 'nexus_net_sync',
                    description: 'Sync and retrieve new messages (insights and skills) published by other Nexus agents on the NexusNet Relay.',
                    inputSchema: {
                        type: 'object',
                        properties: {}
                    },
                },
                {
                    name: 'nexus_entangle',
                    description: 'Measure an entangled agent state, returning the collapsed decision and its correlation score.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            systemId: { type: 'string', description: 'ID of the entangled system (e.g. "phantom_workers")' },
                            agentId: { type: 'string', description: 'ID of the agent being measured' },
                            basis: { type: 'string', description: 'Measurement basis (e.g. "feature_x")' },
                        },
                        required: ['systemId', 'agentId', 'basis'],
                    },
                },
                {
                    name: 'nexus_cas_compress',
                    description: 'Compress a sequence of tokens using Continuous Attention Streams.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            tokens: { type: 'array', items: { type: 'string' }, description: 'Tokens to compress' },
                        },
                        required: ['tokens'],
                    },
                },
                {
                    name: 'nexus_kv_bridge_status',
                    description: 'Get the status of the AdaptiveKVMerge Bridge consensus and metrics.',
                    inputSchema: {
                        type: 'object',
                        properties: {}
                    },
                },
                {
                    name: 'nexus_kv_adapt',
                    description: 'Adapt the KV bridge to a new task type using 10-shot FOMAML.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            taskType: { type: 'string', description: 'Task type identifier' },
                        },
                        required: ['taskType'],
                    },
                },
                // ── Advanced UX Interaction Layer ────────────────────────────────
                {
                    name: 'nexus_decompose_task',
                    description: 'Decompose a complex task into a structured execution plan. Prints a visual ASCII tree to the CLI to keep the user informed. Call this before embarking on multi-step work.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            goal: { type: 'string', description: 'The overarching core goal' },
                            steps: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'The sequence of steps to execute'
                            }
                        },
                        required: ['goal', 'steps'],
                    },
                },
                {
                    name: 'nexus_request_affirmation',
                    description: 'Pause execution and explicitly ask the human user for affirmation to proceed. Creates a highly visible RED/YELLOW warning block in the CLI. Use this before major, destructive, or ambiguous operations.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            message: { type: 'string', description: 'The question or warning for the user' },
                            severity: { type: 'string', enum: ['warning', 'critical'], description: 'Severity of the checkpoint' },
                        },
                        required: ['message', 'severity'],
                    },
                },
                {
                    name: 'nexus_assemble_context',
                    description: 'Declare the active working set of files explicitly to the user. Outputs a visual map of the loaded context dependencies.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            files: { type: 'array', items: { type: 'string' }, description: 'List of files currently focused on' },
                            reason: { type: 'string', description: 'Why this context was assembled' }
                        },
                        required: ['files', 'reason'],
                    },
                },
                // ── Nexus Layer (v1.5) ──────────────────────────────────────────
                {
                    name: 'nexus_execute_nxl',
                    description: 'Execute a declarative Nexus Language (NXL) script as a real runtime graph across worktree-backed sub-agents, verification workers, and merge consensus.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            goal: { type: 'string', description: 'The overarching core goal' },
                            nxlScript: { type: 'string', description: 'Optional: Raw NXL/YAML script content' },
                            useCase: { type: 'string', description: 'Optional: Use case for induction (e.g. "PDLC", "Research")' }
                        },
                        required: ['goal'],
                    },
                },
                {
                    name: 'nexus_publish_trace',
                    description: 'Publish a successful execution trace or research chain to the Federated Knowledge Relay (Gists).',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            taskId: { type: 'string', description: 'ID of the task being summarized' },
                            goal: { type: 'string', description: 'The original goal' },
                            findings: { type: 'array', items: { type: 'string' }, description: 'Key findings or steps' },
                            confidence: { type: 'number', description: 'Confidence score 0-1' }
                        },
                        required: ['taskId', 'goal', 'findings'],
                    },
                },
            ];
    }

    private shouldAppendTelemetryFooter(toolName: string): boolean {
        return !new Set([
            'nexus_session_bootstrap',
            'nexus_orchestrate',
            'nexus_memory_stats',
            'nexus_store_memory',
            'nexus_ghost_pass',
        ]).has(toolName);
    }

    private setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            const profile = this.getToolProfile();
            this.getRuntime().recordClientInstructionStatus({
                clientId: this.name,
                clientFamily: this.name === 'openclaw' ? 'antigravity' : this.name,
                toolProfile: profile,
                status: profile === 'autonomous' ? 'guided' : 'manual',
                summary: this.describeClientInstructionStatus(profile),
                updatedAt: Date.now(),
            });
            return {
                tools: this.finalizeToolDefinitions(this.buildToolDefinitions(), profile),
            };
        });

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            if (!this.nexusRef) {
                throw new McpError(ErrorCode.InternalError, 'NexusPrime reference not set in MCP adapter.');
            }

            this.telemetry.recordCall();
            this.sessionDNA.recordToolCall();
            const result = await this.handleToolCall(request);

            if (this.shouldAppendTelemetryFooter(String(request.params?.name ?? '')) && result.content && Array.isArray(result.content) && result.content.length > 0) {
                const memStats = this.nexusRef.memory.getStats();
                const footer = this.telemetry.format(memStats);
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

        const args = request.params.arguments ?? {};
        const goal = String(args.goal ?? args.task ?? args.prompt ?? '');
        const toolName = String(request.params.name ?? '');
        this.getRuntime().recordClientToolCall(toolName, {
            bootstrapCalled: toolName === 'nexus_session_bootstrap',
            orchestrateCalled: toolName === 'nexus_orchestrate',
            plannerCalled: toolName === 'nexus_plan_execution',
            tokenOptimizationApplied: toolName === 'nexus_optimize_tokens',
            toolProfile: this.getToolProfile(),
        });

        // v1.5 Mandatory Induction Interceptor
        if (goal && goal.length > 50 && !['nexus_execute_nxl', 'nexus_session_bootstrap', 'nexus_plan_execution'].includes(request.params.name)) {
            this.box('🚀 MANDATORY INDUCTION', [
                `Goal: ${goal.substring(0, 60)}...`,
                `Result: Specialized agent army induced by default.`,
                `Status: Multi-agent PDLC active.`
            ], '33');
            const swarm = await this.getOrchestrator().induce(goal);
            nexusEventBus.emit('nexusnet.sync', { newItemsCount: swarm.length });
        }

        switch (request.params.name) {

            case 'nexus_session_bootstrap': {
                const bootstrapGoal = String(request.params.arguments?.goal ?? request.params.arguments?.prompt ?? '');
                const files = Array.isArray(request.params.arguments?.files)
                    ? (request.params.arguments.files as unknown[]).map(String)
                    : undefined;
                const bootstrap = await this.getOrchestrator().bootstrapSession(bootstrapGoal, { files });
                const payload = {
                    client: bootstrap.client,
                    memoryRecall: bootstrap.memoryRecall,
                    memoryStats: bootstrap.memoryStats,
                    recommendedNextStep: bootstrap.recommendedNextStep,
                    recommendedExecutionMode: bootstrap.recommendedExecutionMode,
                    shortlist: bootstrap.shortlist,
                    tokenOptimization: bootstrap.tokenOptimization,
                    reviewGates: bootstrap.reviewGates,
                    catalogHealth: bootstrap.catalogHealth,
                    sourceMixRecommendation: bootstrap.sourceMixRecommendation,
                    ragCandidateStatus: bootstrap.ragCandidateStatus,
                    clientBootstrapStatus: bootstrap.clientBootstrapStatus,
                    artifactSelectionAudit: bootstrap.artifactSelectionAudit,
                    taskGraphPreview: bootstrap.taskGraphPreview,
                    workerPlanPreview: bootstrap.workerPlanPreview,
                    knowledgeFabric: bootstrap.knowledgeFabric,
                    mcpToolProfile: this.getToolProfile(),
                };
                return {
                    content: [{
                        type: 'text',
                        text: [
                            'Session bootstrap ready.',
                            formatBullets([
                                `Client: ${bootstrap.client?.displayName || bootstrap.client?.clientId || 'unknown'} (${bootstrap.client?.state || 'unknown'})`,
                                `Memory recall: ${bootstrap.memoryRecall?.count ?? 0} result(s)`,
                                `Memory stats: prefrontal ${bootstrap.memoryStats?.prefrontal ?? 0} · hippocampus ${bootstrap.memoryStats?.hippocampus ?? 0} · cortex ${bootstrap.memoryStats?.cortex ?? 0}`,
                                `Recommended next step: ${bootstrap.recommendedNextStep || 'nexus_orchestrate'}`,
                                `Execution mode: ${bootstrap.recommendedExecutionMode || 'autonomous'}`,
                                `Token optimization: ${bootstrap.tokenOptimization?.required ? 'required before broad reading' : 'not required yet'}`,
                                `Catalog health: ${bootstrap.catalogHealth?.overall || 'unknown'} · selected ${bootstrap.artifactSelectionAudit?.selected?.length || 0}`,
                                `Knowledge fabric: ${bootstrap.sourceMixRecommendation?.dominantSource || bootstrap.knowledgeFabric?.dominantSource || 'awaiting source mix'}`,
                                `RAG: ${bootstrap.ragCandidateStatus?.attachedCollections || 0} attached · ${bootstrap.ragCandidateStatus?.retrievedChunks || 0} retrieved`,
                                `Task graph: ${bootstrap.taskGraphPreview?.phases?.length || 0} phases · ${bootstrap.taskGraphPreview?.independentBranches || 0} branches`,
                                `Worker plan: ${bootstrap.workerPlanPreview?.totalWorkers || 0} lanes planned`,
                                `Bootstrap status: ${bootstrap.clientBootstrapStatus?.clients?.length || 0} client manifests tracked`,
                            ]),
                            formatJsonDetails('Structured details', payload),
                        ].join('\n\n'),
                    }],
                };
            }

            case 'nexus_orchestrate': {
                const prompt = String(request.params.arguments?.prompt ?? request.params.arguments?.goal ?? '');
                const files = Array.isArray(request.params.arguments?.files)
                    ? (request.params.arguments.files as unknown[]).map(String)
                    : undefined;
                const workers = request.params.arguments?.workers == null
                    ? undefined
                    : Number(request.params.arguments.workers);
                const skills = Array.isArray(request.params.arguments?.skills)
                    ? (request.params.arguments.skills as unknown[]).map(String)
                    : undefined;
                const workflows = Array.isArray(request.params.arguments?.workflows)
                    ? (request.params.arguments.workflows as unknown[]).map(String)
                    : undefined;
                const hooks = Array.isArray(request.params.arguments?.hooks)
                    ? (request.params.arguments.hooks as unknown[]).map(String)
                    : undefined;
                const automations = Array.isArray(request.params.arguments?.automations)
                    ? (request.params.arguments.automations as unknown[]).map(String)
                    : undefined;
                const crews = Array.isArray(request.params.arguments?.crews)
                    ? (request.params.arguments.crews as unknown[]).map(String)
                    : undefined;
                const specialists = Array.isArray(request.params.arguments?.specialists)
                    ? (request.params.arguments.specialists as unknown[]).map(String)
                    : undefined;
                const optimizationProfile = request.params.arguments?.optimizationProfile
                    ? String(request.params.arguments.optimizationProfile) as 'standard' | 'max'
                    : undefined;
                try {
                    const execution = await this.nexusRef.orchestrate(prompt, {
                        files,
                        workers,
                        skillNames: skills,
                        workflowSelectors: workflows,
                        hookSelectors: hooks,
                        automationSelectors: automations,
                        crewSelectors: crews,
                        specialistSelectors: specialists,
                        optimizationProfile,
                    });
                    const verifiedWorkers = execution.workerResults.filter((worker) => worker.verified).length;
                    execution.activeSkills.forEach((skill) => this.sessionDNA.recordSkill(skill.name));
                    execution.workerResults.forEach((result) => {
                        result.modifiedFiles.forEach((file) => this.sessionDNA.recordFileModified(file));
                    });
                    const runtimeUsage = this.getRuntime().getUsageSnapshot();
                    this.sessionDNA.recordDecision(
                        'Orchestrated autonomous run completed',
                        execution.result || summarizeExecution(execution),
                        execution.state === 'merged' ? 0.95 : execution.state === 'rolled_back' ? 0.55 : 0.3
                    );
                    const payload = {
                        runId: execution.runId,
                        state: execution.state,
                        result: execution.result,
                        summary: summarizeExecution(execution),
                        artifactsPath: execution.artifactsPath,
                        planner: execution.plannerState
                            ? {
                                selectedCrew: execution.plannerState.selectedCrew?.name,
                                selectedSpecialists: execution.plannerState.selectedSpecialists.map((specialist) => specialist.name),
                                selectedSkills: execution.plannerState.selectedSkills,
                                selectedWorkflows: execution.plannerState.selectedWorkflows,
                                reviewGates: execution.plannerState.reviewGates.map((gate) => `${gate.gate}:${gate.status}`),
                            }
                            : undefined,
                        selectionAudit: runtimeUsage.artifactSelectionAudit,
                        artifactOutcome: runtimeUsage.artifactOutcome ?? execution.artifactOutcome,
                        workerPlan: runtimeUsage.workerPlan ?? execution.workerPlan,
                        taskGraph: runtimeUsage.taskGraph ?? execution.taskGraph,
                        tokenBudget: runtimeUsage.sourceAwareTokenBudget,
                        catalogHealth: runtimeUsage.catalogHealth,
                        bootstrapManifestStatus: runtimeUsage.bootstrapManifestStatus,
                        worktreeHealth: runtimeUsage.worktreeHealth,
                        ragUsageSummary: runtimeUsage.ragUsageSummary ?? execution.ragUsageSummary,
                        memoryScopeUsage: runtimeUsage.memoryScopeUsage ?? execution.memoryScopeUsage,
                        memoryReconciliationSummary: runtimeUsage.memoryReconciliationSummary ?? execution.memoryReconciliationSummary,
                        tokens: execution.tokenTelemetry,
                        verifiedWorkers,
                        continuationChildren: execution.continuationChildren,
                    };

                    return {
                        content: [{
                            type: 'text',
                            text: [
                                `Orchestrated run ${execution.state}.`,
                                formatBullets([
                                    `Run ID: ${execution.runId}`,
                                    `Summary: ${summarizeExecution(execution)}`,
                                    `Crew: ${execution.plannerState?.selectedCrew?.name || 'baseline path'}`,
                                    `Specialists: ${execution.plannerState?.selectedSpecialists.map((specialist) => specialist.name).slice(0, 4).join(', ') || 'none selected'}`,
                                    `Assets: ${(execution.activeSkills || []).length} skills · ${(execution.activeWorkflows || []).length} workflows · ${(runtimeUsage.artifactSelectionAudit?.selected?.length || 0)} audited selections`,
                                    `Task graph: ${runtimeUsage.taskGraph?.phases?.length || execution.taskGraph?.phases?.length || 0} phases · ${runtimeUsage.workerPlan?.totalWorkers || execution.workerPlan?.totalWorkers || 0} worker lanes`,
                                    `Catalog health: ${runtimeUsage.catalogHealth?.overall || 'unknown'}`,
                                    `Verification: ${verifiedWorkers}/${execution.workerResults.length} worker(s) verified`,
                                    `Worktrees: ${runtimeUsage.worktreeHealth?.overall || 'unknown'} · repaired ${runtimeUsage.worktreeHealth?.repairedEntries || 0} · broken ${runtimeUsage.worktreeHealth?.brokenEntries || 0}`,
                                    `Tokens: saved ${Number(execution.tokenTelemetry?.savedTokens || 0).toLocaleString()} · compression ${Number(execution.tokenTelemetry?.compressionPct || 0)}% · dominant ${runtimeUsage.sourceAwareTokenBudget?.dominantSource || execution.knowledgeFabric?.sourceMix?.dominantSource || 'repo'}`,
                                    `RAG: ${(runtimeUsage.ragUsageSummary?.attachedCollections || execution.knowledgeFabric?.rag.attachedCollections.length || 0)} attached · ${(runtimeUsage.ragUsageSummary?.retrievedChunks || execution.knowledgeFabric?.rag.hits.length || 0)} retrieved`,
                                    `Memory scopes: ${Object.entries(runtimeUsage.memoryScopeUsage?.byScope || execution.memoryScopeUsage?.byScope || {}).map(([scope, count]) => `${scope}:${count}`).join(' · ') || 'awaiting shared/session reads'}`,
                                ]),
                                execution.result ? `Result\n\`\`\`\n${execution.result}\n\`\`\`` : '',
                                formatJsonDetails('Structured details', payload),
                            ].filter(Boolean).join('\n\n'),
                        }],
                    };
                } catch (error: any) {
                    const runtimeUsage = this.getRuntime().getUsageSnapshot();
                    const worktreeHealth = runtimeUsage?.worktreeHealth;
                    const remediation = Array.isArray(error?.remediation) ? error.remediation : [];
                    const message = String(error?.message || error || 'Unknown orchestrate failure');
                    const payload = {
                        state: 'failed',
                        summary: 'Orchestrated run failed before completion.',
                        error: message,
                        remediation,
                        worktreeHealth,
                        skipReasons: runtimeUsage?.skipReasons || [],
                    };
                    return {
                        content: [{
                            type: 'text',
                            text: [
                                'Orchestrated run failed before completion.',
                                formatBullets([
                                    `Cause: ${message.split('\n')[0]}`,
                                    `Worktrees: ${worktreeHealth?.overall || 'unknown'} · repaired ${worktreeHealth?.repairedEntries || 0} · broken ${worktreeHealth?.brokenEntries || 0}`,
                                    remediation.length ? `Remediation: ${remediation.join(' · ')}` : 'Remediation: rerun after pruning stale worktree metadata or repairing the repo worktree state',
                                    runtimeUsage?.skipReasons?.length ? `Skipped stages: ${runtimeUsage.skipReasons.join(' · ')}` : 'Skipped stages: not recorded',
                                ]),
                                formatJsonDetails('Structured details', payload),
                            ].join('\n\n'),
                        }],
                    };
                }
            }

            case 'nexus_store_memory': {
                const content = String(request.params.arguments?.content ?? '');
                const priority = Number(request.params.arguments?.priority ?? 0.7);
                const tags = Array.isArray(request.params.arguments?.tags)
                    ? (request.params.arguments.tags as unknown[]).map(String)
                    : [];

                // Guardrail: MEMORY_SIZE_GUARD auto-check
                const guardCtx = { action: `nexus_store_memory: ${content}` };
                const guardCheck = guardrailEngine.check(guardCtx);
                if (!guardCheck.passed) {
                    return {
                        content: [{
                            type: 'text',
                            text: `❌ GUARDRAIL BLOCKED: ${guardrailEngine.format(guardCheck)}`
                        }]
                    };
                }

                const id = this.nexusRef.storeMemory(content, priority, tags);
                this.telemetry.recordStore();
                this.sessionDNA.recordMemoryStore();
                const memStats = this.nexusRef.getMemoryStats();
                const notification = this.telemetry.notifyStore(priority, tags, memStats);
                const nudge = this.telemetry.planningNudge('store', { priority });

                // Auto-Gist Publish Phase 8
                let autoGistNote = '';
                if (priority >= 0.8) {
                    try {
                        const publishResult = await nexusNetRelay.publish('knowledge', { content, tags });
                        nexusEventBus.emit('nexusnet.publish', { type: 'knowledge', byteSize: publishResult.bytes });
                        autoGistNote = publishResult.configured
                            ? `\n🌐 Auto-Published to NexusNet Relay (ID: ${publishResult.id})`
                            : `\n⚠️ NexusNet relay unconfigured. Auto-publish skipped.`;
                    } catch (e: any) {
                        autoGistNote = `\n⚠️ Auto-Publish to NexusNet failed: ${e.message}`;
                    }
                }

                // Console ASCII UI
                this.box('🧠 CORTEX MEMORY STORED', [
                    `Priority: ${priority.toFixed(2).padEnd(5)} Tags: ${tags.join(', ').substring(0, 31).padEnd(31)}`,
                    `${content.substring(0, 56).padEnd(56, ' ').replace(/\n/g, ' ')}...`,
                    ...(autoGistNote ? [`\x1b[33m${autoGistNote.replace('\n', '').substring(0, 62).padEnd(64, ' ')}\x1b[0m`] : [])
                ], '36');

                return {
                    content: [{
                        type: 'text',
                        text: [
                            'Memory stored.',
                            formatBullets([
                                `ID: ${id}`,
                                `Priority: ${priority.toFixed(2)}`,
                                `Tags: ${tags.join(', ') || 'none'}`,
                                `Content: ${content.slice(0, 140).replace(/\n+/g, ' ')}`,
                                autoGistNote ? autoGistNote.replace(/^\s+/, '') : 'Relay publish: skipped',
                            ]),
                            notification,
                            nudge,
                        ].filter(Boolean).join('\n\n'),
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
                // Console ASCII UI
                this.box('🔍 CORTEX MEMORY RECALL', [
                    `Query: ${query.replace(/\n/g, ' ').substring(0, 57).padEnd(59, ' ')}`,
                    `Retrieved: ${memories.length.toString().padEnd(55, ' ')}`
                ], '35');

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
                const health = typeof this.nexusRef.getMemoryHealth === 'function'
                    ? this.nexusRef.getMemoryHealth()
                    : undefined;
                return {
                    content: [{
                        type: 'text',
                        text: [
                            'Memory inventory ready.',
                            formatBullets([
                                `Prefrontal: ${stats.prefrontal} item(s)`,
                                `Hippocampus: ${stats.hippocampus} item(s)`,
                                `Cortex: ${stats.cortex} item(s)`,
                                `Zettelkasten links: ${stats.totalLinks}`,
                                `Top tags: ${stats.topTags.join(', ') || 'none yet'}`,
                                stats.oldestEntry
                                    ? `Oldest entry: ${new Date(stats.oldestEntry).toLocaleDateString()}`
                                    : 'Oldest entry: none yet',
                                health ? `Health: ${health.active} active · ${health.quarantined} quarantined · ${health.shared} shared` : null,
                            ]),
                        ].join('\n\n'),
                    }],
                };
            }

            case 'nexus_memory_export': {
                const result = this.nexusRef.exportMemoryBundle({
                    limit: request.params.arguments?.limit == null ? undefined : Number(request.params.arguments.limit),
                    scope: request.params.arguments?.scope ? String(request.params.arguments.scope) as any : undefined,
                    state: request.params.arguments?.state ? String(request.params.arguments.state) as any : undefined,
                    sessionId: request.params.arguments?.sessionId ? String(request.params.arguments.sessionId) : undefined,
                });
                return {
                    content: [{
                        type: 'text',
                        text: [
                            'Memory export ready.',
                            formatBullets([
                                `Session: ${result?.sessionId || 'n/a'}`,
                                `Items: ${Number(result?.items?.length || 0)}`,
                                `Generated: ${result?.exportedAt ? new Date(result.exportedAt).toISOString() : 'n/a'}`,
                            ]),
                            formatJsonDetails('Structured details', result ?? {}),
                        ].join('\n\n'),
                    }],
                };
            }

            case 'nexus_memory_backup': {
                const result = this.nexusRef.backupMemoryBundle({
                    limit: request.params.arguments?.limit == null ? undefined : Number(request.params.arguments.limit),
                    scope: request.params.arguments?.scope ? String(request.params.arguments.scope) as any : undefined,
                    state: request.params.arguments?.state ? String(request.params.arguments.state) as any : undefined,
                    sessionId: request.params.arguments?.sessionId ? String(request.params.arguments.sessionId) : undefined,
                });
                return {
                    content: [{
                        type: 'text',
                        text: [
                            'Memory backup written.',
                            formatBullets([
                                `Path: ${result?.path || 'n/a'}`,
                                `Session: ${result?.bundle?.sessionId || 'n/a'}`,
                                `Items: ${Number(result?.bundle?.items?.length || 0)}`,
                            ]),
                            formatJsonDetails('Structured details', result ?? {}),
                        ].join('\n\n'),
                    }],
                };
            }

            case 'nexus_memory_import': {
                const result = this.nexusRef.importMemoryBundle({
                    path: request.params.arguments?.path ? String(request.params.arguments.path) : undefined,
                    bundle: request.params.arguments?.bundle,
                });
                return {
                    content: [{
                        type: 'text',
                        text: [
                            'Memory import complete.',
                            formatBullets([
                                `Imported: ${Number(result?.imported || 0)}`,
                                `Duplicates skipped: ${Number(result?.duplicates || 0)}`,
                                `Quarantined on import: ${Number(result?.quarantined || 0)}`,
                            ]),
                            formatJsonDetails('Structured details', result ?? {}),
                        ].join('\n\n'),
                    }],
                };
            }

            case 'nexus_memory_maintain': {
                const result = this.nexusRef.maintainMemory();
                return {
                    content: [{
                        type: 'text',
                        text: [
                            'Memory maintenance complete.',
                            formatBullets([
                                `Expired: ${Number(result?.expired || 0)}`,
                                `Cooled: ${Number(result?.cooled || 0)}`,
                                `Quarantined: ${Number(result?.quarantined || 0)}`,
                                `Scrap marked: ${Number(result?.scrapMarked || 0)}`,
                                `Retained active: ${Number(result?.retained || 0)}`,
                            ]),
                            formatJsonDetails('Structured details', result ?? {}),
                        ].join('\n\n'),
                    }],
                };
            }

            case 'nexus_memory_trace': {
                const id = String(request.params.arguments?.id ?? '');
                const detail = this.nexusRef.traceMemory(id);
                if (!detail) {
                    return {
                        content: [{
                            type: 'text',
                            text: `Memory trace unavailable for ${id}.`,
                        }],
                    };
                }
                return {
                    content: [{
                        type: 'text',
                        text: [
                            'Memory trace ready.',
                            formatBullets([
                                `ID: ${detail.id}`,
                                `Scope: ${detail.scope} · state ${detail.state} · source ${detail.source}`,
                                `Importance: ${Number(detail.importanceScore || 0).toFixed(2)} · relevance ${Number(detail.relevanceScore || 0).toFixed(2)} · trust ${Number(detail.trustScore || 0).toFixed(2)}`,
                                `Lineage: ${detail.lineage?.length || 0} item(s) · backlinks ${detail.linkedMemories?.length || 0}`,
                                `Reconciliation: ${detail.reconciliation?.action || 'none recorded'}`,
                            ]),
                            formatJsonDetails('Structured details', detail),
                        ].join('\n\n'),
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

                this.nexusRef.storeMemory(
                    `Ghost pass for "${goal.slice(0, 80)}": ${report.riskAreas.length} risks identified.`,
                    0.6, ['#ghost-pass']
                );

                nexusEventBus.emit('ghost.pass', { task: goal, risks: report.riskAreas.length, workers: report.workerAssignments.length });

                const ghostNudge = this.telemetry.planningNudge('ghost_pass', { risks: report.riskAreas.length });

                // Console ASCII UI
                const rCount = report.riskAreas.length;
                this.box('👻 GHOST PASS PRE-FLIGHT', [
                    `Task: ${goal.replace(/\n/g, ' ').substring(0, 58).padEnd(60, ' ')}`,
                    `${rCount > 0 ? `\x1b[31m⚠️  ${rCount} Risks Detected\x1b[0m` : '✅ No obvious risks'}`.padEnd(76, ' '),
                    `Workers Suggested: ${report.workerAssignments.length.toString().padEnd(46, ' ')}`
                ], '33');

                return {
                    content: [{
                        type: 'text',
                        text: [
                            'Ghost pass complete.',
                            formatBullets([
                                `Task ID: ${report.taskId}`,
                                `Estimated tokens: ${report.totalEstimatedTokens.toLocaleString()}`,
                                `Risks: ${report.riskAreas.length ? report.riskAreas.join(' | ') : 'none detected'}`,
                                `Worker approaches: ${report.workerAssignments.length}`,
                            ]),
                            'Reading plan\n```txt\n' + formatReadingPlan(report.readingPlan) + '\n```',
                            report.workerAssignments.length
                                ? formatBullets(report.workerAssignments.map((worker, index) => `Worker ${index + 1}: ${worker.approach} · budget ${worker.tokenBudget.toLocaleString()} tokens`))
                                : '',
                            ghostNudge,
                        ].filter(Boolean).join('\n\n'),
                    }],
                };
            }

            case 'nexus_spawn_workers': {
                const goal = String(request.params.arguments?.goal ?? '');
                const workersCount = Number(request.params.arguments?.workers ?? 3);
                const rawFiles = Array.isArray(request.params.arguments?.files)
                    ? (request.params.arguments.files as unknown[]).map(String)
                    : [];
                const verifyCommands = Array.isArray(request.params.arguments?.verify)
                    ? (request.params.arguments.verify as unknown[]).map(String)
                    : undefined;
                const strategies = Array.isArray(request.params.arguments?.strategies)
                    ? (request.params.arguments.strategies as unknown[]).map(String)
                    : undefined;
                const actions = Array.isArray(request.params.arguments?.actions)
                    ? (request.params.arguments.actions as any[])
                    : [];
                const skills = Array.isArray(request.params.arguments?.skills)
                    ? (request.params.arguments.skills as unknown[]).map(String)
                    : undefined;
                const workflows = Array.isArray(request.params.arguments?.workflows)
                    ? (request.params.arguments.workflows as unknown[]).map(String)
                    : undefined;
                const crews = Array.isArray(request.params.arguments?.crews)
                    ? (request.params.arguments.crews as unknown[]).map(String)
                    : undefined;
                const specialists = Array.isArray(request.params.arguments?.specialists)
                    ? (request.params.arguments.specialists as unknown[]).map(String)
                    : undefined;
                const memoryBackend = request.params.arguments?.memoryBackend
                    ? String(request.params.arguments.memoryBackend)
                    : undefined;
                const compressionBackend = request.params.arguments?.compressionBackend
                    ? String(request.params.arguments.compressionBackend)
                    : undefined;
                const dslCompiler = request.params.arguments?.dslCompiler
                    ? String(request.params.arguments.dslCompiler)
                    : undefined;
                const backendMode = request.params.arguments?.backendMode
                    ? String(request.params.arguments.backendMode) as 'default' | 'shadow' | 'experimental'
                    : undefined;
                const optimizationProfile = request.params.arguments?.optimizationProfile
                    ? String(request.params.arguments.optimizationProfile) as 'standard' | 'max'
                    : undefined;

                const execution = await this.getRuntime().run({
                    goal,
                    files: rawFiles,
                    workers: workersCount,
                    roles: ['planner', 'coder', 'verifier', 'skill-maker', 'research-shadow'],
                    verifyCommands,
                    strategies,
                    actions,
                    skillNames: skills,
                    workflowSelectors: workflows,
                    crewSelectors: crews,
                    specialistSelectors: specialists,
                    backendSelectors: { memoryBackend, compressionBackend, dslCompiler },
                    backendMode,
                    optimizationProfile,
                    executionMode: 'manual-low-level',
                    manualOverrides: ['nexus_spawn_workers'],
                });

                const verifiedWorkers = execution.workerResults.filter(result => result.verified).length;
                const modifiedFiles = execution.workerResults.reduce((sum, result) => sum + result.modifiedFiles.length, 0);

                execution.activeSkills.forEach(skill => {
                    this.sessionDNA.recordSkill(skill.name);
                    if (skill.scope === 'global' || skill.rolloutStatus === 'promoted') {
                        this.sessionDNA.recordSkillLearned(skill.name);
                    }
                });
                execution.workerResults.forEach(result => {
                    result.modifiedFiles.forEach(file => this.sessionDNA.recordFileModified(file));
                });
                this.sessionDNA.recordDecision(
                    'Runtime swarm execution completed',
                    execution.result || summarizeExecution(execution),
                    execution.state === 'merged' ? 0.94 : execution.state === 'rolled_back' ? 0.45 : 0.3
                );

                this.nexusRef.storeMemory(
                    `Runtime swarm: state=${execution.state}, workers=${execution.workerResults.length}, verified=${verifiedWorkers}, decision=${execution.finalDecision?.action ?? 'none'}`,
                    execution.state === 'merged' ? 0.92 : 0.72,
                    ['#phantom', '#decision', execution.state]
                );

                if (execution.finalDecision) {
                    nexusEventBus.emit('phantom.merge', {
                        action: execution.finalDecision.action,
                        winner: execution.finalDecision.recommendedStrategy,
                    });
                    await this.nexusRef.analyzeLearning(goal, execution.finalDecision);
                }

                this.box('🐝 PHANTOM RUNTIME', [
                    `Run: ${execution.runId.padEnd(28, ' ')} State: ${execution.state.padEnd(18, ' ')}`,
                    `Workers: ${execution.workerResults.length.toString().padEnd(5, ' ')} Verified: ${verifiedWorkers.toString().padEnd(10, ' ')} Files: ${String(modifiedFiles).padEnd(12, ' ')}`,
                    `Decision: ${(execution.finalDecision?.action ?? 'none').padEnd(52, ' ')}`
                ], execution.state === 'merged' ? '32' : execution.state === 'rolled_back' ? '33' : '31');

                return {
                    content: [{
                        type: 'text',
                        text: [
                            `🐝 Phantom Runtime — ${summarizeExecution(execution)}`,
                            '',
                            `Run ID: ${execution.runId}`,
                            `State: ${execution.state}`,
                            `Artifacts: ${execution.artifactsPath}`,
                            `Workers: ${execution.workerResults.length}`,
                            `Verified Workers: ${verifiedWorkers}`,
                            `Modified Files: ${modifiedFiles}`,
                            `Decision: ${execution.finalDecision?.action ?? 'none'}`,
                            `Recommended Strategy: ${execution.finalDecision?.recommendedStrategy ?? 'n/a'}`,
                            `Planner: ${execution.plannerResult?.summary ?? 'n/a'}`,
                            `Crew: ${execution.plannerResult?.selectedCrew?.name ?? 'n/a'}`,
                            `Specialists: ${execution.plannerResult?.selectedSpecialists?.length ? execution.plannerResult.selectedSpecialists.map((specialist) => specialist.name).join(', ') : 'none'}`,
                            `Fallback: ${execution.plannerResult?.fallbackPlan?.summary ?? 'current runtime fallback'}`,
                            `Backends: memory=${execution.selectedBackends.memoryBackend}, compression=${execution.selectedBackends.compressionBackend}, consensus=${execution.selectedBackends.consensusPolicy}, dsl=${execution.selectedBackends.dslCompiler}`,
                            `Active Skills: ${execution.activeSkills.length > 0 ? execution.activeSkills.map(skill => `${skill.name}(${skill.riskClass})`).join(', ') : 'none'}`,
                            `Active Workflows: ${execution.activeWorkflows.length > 0 ? execution.activeWorkflows.map(workflow => workflow.name).join(', ') : 'none'}`,
                            `Promotions: ${execution.promotionDecisions.length > 0 ? execution.promotionDecisions.map(decision => `${decision.kind}:${decision.target}:${decision.approved ? 'approved' : 'held'}`).join(', ') : 'none'}`,
                            '',
                            `Result: ${execution.result}`
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

            case 'nexus_skill_register': {
                const graphEngine = getGraphEngine();
                const registry = new SkillCardRegistry(graphEngine);
                const card = request.params.arguments?.card as SkillCard;

                if (!card || !card.name || !card.trigger || !card.actions) {
                    throw new McpError(ErrorCode.InvalidParams, 'Invalid SkillCard format. Must contain name, trigger, and actions.');
                }

                const id = registry.register(card);
                nexusEventBus.emit('skill.register', { name: card.name, id });

                return {
                    content: [{
                        type: 'text',
                        text: `🎯 Skill Card "${card.name}" registered successfully!\nEntity ID: ${id}\nYAML serialized and stored in Graph Knowledge Engine.`
                    }]
                };
            }

            case 'nexus_skill_generate': {
                const name = String(request.params.arguments?.name ?? '');
                const instructions = String(request.params.arguments?.instructions ?? '');
                const riskClass = String(request.params.arguments?.riskClass ?? 'orchestrate') as 'read' | 'orchestrate' | 'mutate';
                const scope = String(request.params.arguments?.scope ?? 'session') as 'session' | 'worker' | 'global';
                const artifact = this.getRuntime().generateSkill({ name, instructions, riskClass, scope, provenance: 'mcp:generate' });
                this.sessionDNA.recordSkillLearned(artifact.name);
                return {
                    content: [{
                        type: 'text',
                        text: `🧠 Runtime skill generated\nID: ${artifact.skillId}\nName: ${artifact.name}\nRisk: ${artifact.riskClass}\nScope: ${artifact.scope}\nProvenance: ${artifact.provenance}`,
                    }],
                };
            }

            case 'nexus_skill_deploy': {
                const skillId = String(request.params.arguments?.skillId ?? '');
                const scope = String(request.params.arguments?.scope ?? 'session') as 'session' | 'worker' | 'global';
                const runtime = this.getRuntime();
                const known = runtime.listSkills().find((skill) => skill.skillId === skillId || skill.name === skillId);
                const artifact = known ? runtime.deploySkill(known.skillId, scope) : undefined;
                if (!artifact) {
                    return { content: [{ type: 'text', text: `❌ Skill not found: ${skillId}` }] };
                }
                this.sessionDNA.recordSkill(artifact.name);
                return {
                    content: [{
                        type: 'text',
                        text: `🚚 Runtime skill deployed\nID: ${artifact.skillId}\nName: ${artifact.name}\nScope: ${artifact.scope}\nRollout: ${artifact.rolloutStatus}`,
                    }],
                };
            }

            case 'nexus_skill_revoke': {
                const skillId = String(request.params.arguments?.skillId ?? '');
                const runtime = this.getRuntime();
                const known = runtime.listSkills().find((skill) => skill.skillId === skillId || skill.name === skillId);
                const artifact = known ? runtime.revokeSkill(known.skillId) : undefined;
                if (!artifact) {
                    return { content: [{ type: 'text', text: `❌ Skill not found: ${skillId}` }] };
                }
                return {
                    content: [{
                        type: 'text',
                        text: `🧯 Runtime skill revoked\nID: ${artifact.skillId}\nName: ${artifact.name}\nRollout: ${artifact.rolloutStatus}`,
                    }],
                };
            }

            case 'nexus_workflow_generate': {
                const name = String(request.params.arguments?.name ?? '');
                const description = String(request.params.arguments?.description ?? '');
                const domain = request.params.arguments?.domain ? String(request.params.arguments?.domain) : undefined;
                const scope = String(request.params.arguments?.scope ?? 'session') as 'session' | 'worker' | 'global';
                const artifact = this.getRuntime().generateWorkflow({ name, description, domain, scope });
                return {
                    content: [{
                        type: 'text',
                        text: `🧭 Workflow generated\nID: ${artifact.workflowId}\nName: ${artifact.name}\nDomain: ${artifact.domain}\nScope: ${artifact.scope}`,
                    }],
                };
            }

            case 'nexus_workflow_deploy': {
                const workflowId = String(request.params.arguments?.workflowId ?? '');
                const scope = String(request.params.arguments?.scope ?? 'session') as 'session' | 'worker' | 'global';
                const runtime = this.getRuntime();
                const known = runtime.listWorkflows().find((workflow) => workflow.workflowId === workflowId || workflow.name === workflowId);
                const artifact = known ? runtime.deployWorkflow(known.workflowId, scope) : undefined;
                if (!artifact) {
                    return { content: [{ type: 'text', text: `❌ Workflow not found: ${workflowId}` }] };
                }
                return {
                    content: [{
                        type: 'text',
                        text: `🚚 Workflow deployed\nID: ${artifact.workflowId}\nName: ${artifact.name}\nScope: ${artifact.scope}\nRollout: ${artifact.rolloutStatus}`,
                    }],
                };
            }

            case 'nexus_workflow_run': {
                const workflowId = String(request.params.arguments?.workflowId ?? '');
                const goalOverride = request.params.arguments?.goal ? String(request.params.arguments.goal) : undefined;
                try {
                    const execution = await this.getRuntime().runWorkflow(workflowId, goalOverride);
                    return {
                        content: [{
                            type: 'text',
                            text: [
                                `🧭 Workflow Runtime — ${summarizeExecution(execution)}`,
                                `Run ID: ${execution.runId}`,
                                `Artifacts: ${execution.artifactsPath}`,
                                `Decision: ${execution.finalDecision?.action ?? 'none'}`,
                                `Workflows: ${execution.activeWorkflows.map((workflow) => workflow.name).join(', ') || 'none'}`,
                                `Result: ${execution.result}`,
                            ].join('\n'),
                        }],
                    };
                } catch (error: any) {
                    return { content: [{ type: 'text', text: `❌ Workflow runtime error: ${error.message}` }] };
                }
            }

            case 'nexus_hook_generate': {
                const name = String(request.params.arguments?.name ?? '');
                const description = String(request.params.arguments?.description ?? '');
                const trigger = String(request.params.arguments?.trigger ?? 'run.created') as HookTrigger;
                const riskClass = String(request.params.arguments?.riskClass ?? 'orchestrate') as 'read' | 'orchestrate' | 'mutate';
                const scope = String(request.params.arguments?.scope ?? 'session') as 'session' | 'worker' | 'global';
                const artifact = this.getRuntime().generateHook({ name, description, trigger, riskClass, scope });
                return {
                    content: [{
                        type: 'text',
                        text: `🪝 Hook generated\nID: ${artifact.hookId}\nName: ${artifact.name}\nTrigger: ${artifact.trigger}\nScope: ${artifact.scope}`,
                    }],
                };
            }

            case 'nexus_hook_deploy': {
                const hookId = String(request.params.arguments?.hookId ?? '');
                const scope = String(request.params.arguments?.scope ?? 'session') as 'session' | 'worker' | 'global';
                const runtime = this.getRuntime();
                const known = runtime.listHooks().find((hook) => hook.hookId === hookId || hook.name === hookId);
                const artifact = known ? runtime.deployHook(known.hookId, scope) : undefined;
                if (!artifact) {
                    return { content: [{ type: 'text', text: `❌ Hook not found: ${hookId}` }] };
                }
                nexusEventBus.emit('hook.deploy', { hookId: artifact.hookId, scope: artifact.scope, status: artifact.rolloutStatus });
                return {
                    content: [{
                        type: 'text',
                        text: `🪝 Hook deployed\nID: ${artifact.hookId}\nName: ${artifact.name}\nScope: ${artifact.scope}\nRollout: ${artifact.rolloutStatus}`,
                    }],
                };
            }

            case 'nexus_hook_revoke': {
                const hookId = String(request.params.arguments?.hookId ?? '');
                const runtime = this.getRuntime();
                const known = runtime.listHooks().find((hook) => hook.hookId === hookId || hook.name === hookId);
                const artifact = known ? runtime.revokeHook(known.hookId) : undefined;
                if (!artifact) {
                    return { content: [{ type: 'text', text: `❌ Hook not found: ${hookId}` }] };
                }
                nexusEventBus.emit('hook.revoke', { hookId: artifact.hookId, status: artifact.rolloutStatus });
                return {
                    content: [{
                        type: 'text',
                        text: `🧯 Hook revoked\nID: ${artifact.hookId}\nName: ${artifact.name}\nRollout: ${artifact.rolloutStatus}`,
                    }],
                };
            }

            case 'nexus_automation_generate': {
                const name = String(request.params.arguments?.name ?? '');
                const description = String(request.params.arguments?.description ?? '');
                const triggerMode = String(request.params.arguments?.triggerMode ?? 'event') as 'event' | 'schedule' | 'connector';
                const eventTrigger = request.params.arguments?.eventTrigger ? String(request.params.arguments?.eventTrigger) as HookTrigger : undefined;
                const scope = String(request.params.arguments?.scope ?? 'session') as 'session' | 'worker' | 'global';
                const artifact = this.getRuntime().generateAutomation({ name, description, triggerMode, eventTrigger, scope });
                return {
                    content: [{
                        type: 'text',
                        text: `🤖 Automation generated\nID: ${artifact.automationId}\nName: ${artifact.name}\nTrigger Mode: ${artifact.triggerMode}\nScope: ${artifact.scope}`,
                    }],
                };
            }

            case 'nexus_automation_deploy': {
                const automationId = String(request.params.arguments?.automationId ?? '');
                const scope = String(request.params.arguments?.scope ?? 'session') as 'session' | 'worker' | 'global';
                const runtime = this.getRuntime();
                const known = runtime.listAutomations().find((automation) => automation.automationId === automationId || automation.name === automationId);
                const artifact = known ? runtime.deployAutomation(known.automationId, scope) : undefined;
                if (!artifact) {
                    return { content: [{ type: 'text', text: `❌ Automation not found: ${automationId}` }] };
                }
                nexusEventBus.emit('automation.deploy', { automationId: artifact.automationId, scope: artifact.scope, status: artifact.rolloutStatus });
                return {
                    content: [{
                        type: 'text',
                        text: `🤖 Automation deployed\nID: ${artifact.automationId}\nName: ${artifact.name}\nScope: ${artifact.scope}\nRollout: ${artifact.rolloutStatus}`,
                    }],
                };
            }

            case 'nexus_automation_run': {
                const automationId = String(request.params.arguments?.automationId ?? '');
                const goalOverride = request.params.arguments?.goal ? String(request.params.arguments.goal) : undefined;
                try {
                    const execution = await this.getRuntime().runAutomation(automationId, goalOverride);
                    return {
                        content: [{
                            type: 'text',
                            text: [
                                `🤖 Automation Runtime — ${summarizeExecution(execution)}`,
                                `Run ID: ${execution.runId}`,
                                `Artifacts: ${execution.artifactsPath}`,
                                `Automations: ${execution.activeAutomations.map((automation) => automation.name).join(', ') || 'none'}`,
                                `Result: ${execution.result}`,
                            ].join('\n'),
                        }],
                    };
                } catch (error: any) {
                    return { content: [{ type: 'text', text: `❌ Automation runtime error: ${error.message}` }] };
                }
            }

            case 'nexus_automation_revoke': {
                const automationId = String(request.params.arguments?.automationId ?? '');
                const runtime = this.getRuntime();
                const known = runtime.listAutomations().find((automation) => automation.automationId === automationId || automation.name === automationId);
                const artifact = known ? runtime.revokeAutomation(known.automationId) : undefined;
                if (!artifact) {
                    return { content: [{ type: 'text', text: `❌ Automation not found: ${automationId}` }] };
                }
                nexusEventBus.emit('automation.revoke', { automationId: artifact.automationId, status: artifact.rolloutStatus });
                return {
                    content: [{
                        type: 'text',
                        text: `🧯 Automation revoked\nID: ${artifact.automationId}\nName: ${artifact.name}\nRollout: ${artifact.rolloutStatus}`,
                    }],
                };
            }

            case 'nexus_memory_audit': {
                const limit = Number(request.params.arguments?.limit ?? 80);
                const audit = this.getRuntime().auditMemory(limit) ?? { scanned: 0, quarantined: [], findings: [] };
                nexusEventBus.emit('memory.audit', { scanned: audit.scanned, quarantined: audit.quarantined.length });
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(audit, null, 2),
                    }],
                };
            }

            case 'nexus_federation_status': {
                const snapshot = this.getRuntime().getNetworkStatus();
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(snapshot, null, 2),
                    }],
                };
            }

            case 'nexus_plan_execution': {
                const goal = String(request.params.arguments?.goal ?? '');
                const files = Array.isArray(request.params.arguments?.files)
                    ? (request.params.arguments.files as unknown[]).map(String)
                    : undefined;
                const skills = Array.isArray(request.params.arguments?.skills)
                    ? (request.params.arguments.skills as unknown[]).map(String)
                    : undefined;
                const workflows = Array.isArray(request.params.arguments?.workflows)
                    ? (request.params.arguments.workflows as unknown[]).map(String)
                    : undefined;
                const crews = Array.isArray(request.params.arguments?.crews)
                    ? (request.params.arguments.crews as unknown[]).map(String)
                    : undefined;
                const specialists = Array.isArray(request.params.arguments?.specialists)
                    ? (request.params.arguments.specialists as unknown[]).map(String)
                    : undefined;
                const optimizationProfile = request.params.arguments?.optimizationProfile
                    ? String(request.params.arguments.optimizationProfile) as 'standard' | 'max'
                    : undefined;

                const planner = await this.getRuntime().planExecution({
                    goal,
                    files,
                    skillNames: skills,
                    workflowSelectors: workflows,
                    crewSelectors: crews,
                    specialistSelectors: specialists,
                    optimizationProfile,
                });

                return {
                    content: [{
                        type: 'text',
                        text: [
                            `🧭 Execution Plan — ${planner.objective}`,
                            '',
                            `Crew: ${planner.selectedCrew.name} (${planner.selectedCrew.confidence.score.toFixed(2)})`,
                            `Specialists: ${planner.selectedSpecialists.length > 0 ? planner.selectedSpecialists.map((specialist) => `${specialist.name}(${specialist.authority})`).join(', ') : 'none'}`,
                            `Skills: ${planner.selectedSkills.length > 0 ? planner.selectedSkills.join(', ') : 'none'}`,
                            `Workflows: ${planner.selectedWorkflows.length > 0 ? planner.selectedWorkflows.join(', ') : 'none'}`,
                            `Tools: ${planner.toolPolicy.allowedTools.join(', ')}`,
                            `Swarm: ${planner.swarmDecision.mode} (${planner.swarmDecision.workers} workers)`,
                            `Fallback: ${planner.fallbackPlan.summary}`,
                            `Review Gates: ${planner.reviewGates.map((gate) => gate.gate).join(', ')}`,
                            '',
                            `Planning Ledger:`,
                            ...planner.ledger.map((row, index) => `${index + 1}. ${row.stage} · ${row.status} · ${row.owner} · ${row.selectedAssets.join(', ') || 'n/a'} · ${row.notes}`),
                        ].join('\n'),
                    }],
                };
            }

            case 'nexus_list_skills': {
                const skills = this.getRuntime().listSkills();
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            total: skills.length,
                            skills: skills.map((skill) => ({
                                skillId: skill.skillId,
                                name: skill.name,
                                scope: skill.scope,
                                rolloutStatus: skill.rolloutStatus,
                                riskClass: skill.riskClass,
                                summary: skill.instructions.slice(0, 220),
                            })),
                        }, null, 2),
                    }],
                };
            }

            case 'nexus_list_specialists': {
                const specialists = this.getRuntime().listSpecialists();
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            total: specialists.length,
                            specialists: specialists.map((specialist) => ({
                                specialistId: specialist.specialistId,
                                name: specialist.name,
                                division: specialist.division,
                                authority: specialist.authority,
                                domains: specialist.domains,
                                recommendedSkills: specialist.recommendedSkills,
                                recommendedWorkflows: specialist.recommendedWorkflows,
                            })),
                        }, null, 2),
                    }],
                };
            }

            case 'nexus_list_crews': {
                const crews = this.getRuntime().listCrews();
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            total: crews.length,
                            crews,
                        }, null, 2),
                    }],
                };
            }

            case 'nexus_rag_list_collections': {
                const collections = this.getOrchestrator().listRagCollections();
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            total: collections.length,
                            collections,
                        }, null, 2),
                    }],
                };
            }

            case 'nexus_rag_create_collection': {
                const name = String(request.params.arguments?.name ?? '');
                const description = request.params.arguments?.description ? String(request.params.arguments.description) : undefined;
                const tags = Array.isArray(request.params.arguments?.tags)
                    ? (request.params.arguments.tags as unknown[]).map(String)
                    : [];
                const scope = String(request.params.arguments?.scope ?? 'session') === 'project' ? 'project' : 'session';
                const collection = this.getOrchestrator().createRagCollection({ name, description, tags, scope });
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(collection, null, 2),
                    }],
                };
            }

            case 'nexus_rag_ingest_collection': {
                const collectionId = String(request.params.arguments?.collectionId ?? '');
                const inputs = Array.isArray(request.params.arguments?.inputs)
                    ? (request.params.arguments.inputs as unknown[]).map((entry: any) => ({
                        filePath: entry?.filePath ? String(entry.filePath) : undefined,
                        url: entry?.url ? String(entry.url) : undefined,
                        text: entry?.text ? String(entry.text) : undefined,
                        label: entry?.label ? String(entry.label) : undefined,
                        tags: Array.isArray(entry?.tags) ? entry.tags.map(String) : [],
                    }))
                    : [];
                const result = await this.getOrchestrator().ingestRagCollection(collectionId, inputs);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(result, null, 2),
                    }],
                };
            }

            case 'nexus_rag_attach_collection': {
                const collectionId = String(request.params.arguments?.collectionId ?? '');
                const collection = this.getOrchestrator().attachRagCollection(collectionId);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(collection, null, 2),
                    }],
                };
            }

            case 'nexus_rag_detach_collection': {
                const collectionId = String(request.params.arguments?.collectionId ?? '');
                const collection = this.getOrchestrator().detachRagCollection(collectionId);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(collection, null, 2),
                    }],
                };
            }

            case 'nexus_rag_delete_collection': {
                const collectionId = String(request.params.arguments?.collectionId ?? '');
                const removed = this.getOrchestrator().deleteRagCollection(collectionId);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ collectionId, removed }, null, 2),
                    }],
                };
            }

            case 'nexus_list_workflows': {
                const workflows = this.getRuntime().listWorkflows();
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            total: workflows.length,
                            workflows: workflows.map((workflow) => ({
                                workflowId: workflow.workflowId,
                                name: workflow.name,
                                scope: workflow.scope,
                                rolloutStatus: workflow.rolloutStatus,
                                domain: workflow.domain,
                                summary: workflow.description,
                            })),
                        }, null, 2),
                    }],
                };
            }

            case 'nexus_list_hooks': {
                const hooks = this.getRuntime().listHooks();
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            total: hooks.length,
                            hooks: hooks.map((hook) => ({
                                hookId: hook.hookId,
                                name: hook.name,
                                trigger: hook.trigger,
                                scope: hook.scope,
                                rolloutStatus: hook.rolloutStatus,
                                riskClass: hook.riskClass,
                                summary: hook.description,
                            })),
                        }, null, 2),
                    }],
                };
            }

            case 'nexus_list_automations': {
                const automations = this.getRuntime().listAutomations();
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            total: automations.length,
                            automations: automations.map((automation) => ({
                                automationId: automation.automationId,
                                name: automation.name,
                                triggerMode: automation.triggerMode,
                                eventTrigger: automation.eventTrigger,
                                scope: automation.scope,
                                rolloutStatus: automation.rolloutStatus,
                                summary: automation.description,
                            })),
                        }, null, 2),
                    }],
                };
            }

            case 'nexus_pattern_search': {
                const query = String(request.params.arguments?.query ?? '');
                const limit = Number(request.params.arguments?.limit ?? 6);
                const results = this.getOrchestrator().searchPatterns(query, limit);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            total: results.length,
                            patterns: results,
                        }, null, 2),
                    }],
                };
            }

            case 'nexus_pattern_list': {
                const limit = Number(request.params.arguments?.limit ?? 8);
                const results = this.getOrchestrator().listPatterns().slice(0, Math.max(1, limit));
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            total: results.length,
                            patterns: results,
                        }, null, 2),
                    }],
                };
            }

            case 'nexus_knowledge_provenance': {
                const provenance = this.getOrchestrator().getKnowledgeFabricProvenance();
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(provenance, null, 2),
                    }],
                };
            }

            case 'nexus_run_status': {
                const runId = String(request.params.arguments?.runId ?? '');
                const run = this.getRuntime().getRun(runId);
                if (!run) {
                    return { content: [{ type: 'text', text: `❌ Run not found: ${runId}` }] };
                }
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            runId: run.runId,
                            state: run.state,
                            result: run.result,
                            artifactsPath: run.artifactsPath,
                            workers: run.workerResults.length,
                            verifiedWorkers: run.workerResults.filter((worker) => worker.verified).length,
                            workflows: run.activeWorkflows.map((workflow) => workflow.name),
                            hooks: run.activeHooks.map((hook) => hook.name),
                            automations: run.activeAutomations.map((automation) => automation.name),
                            planner: run.plannerResult,
                            promotions: run.promotionDecisions,
                            shield: run.shieldDecisions,
                            memoryChecks: run.memoryChecks,
                            federation: run.federationState,
                            backends: run.selectedBackends,
                        }, null, 2),
                    }],
                };
            }

            case 'nexus_darwin_propose': {
                const hypothesis = String(request.params.arguments?.hypothesis ?? '');
                const targetFile = String(request.params.arguments?.targetFile ?? '');
                const approach = String(request.params.arguments?.approach ?? '');

                try {
                    const cycle = darwinLoop.propose(hypothesis, targetFile, approach);
                    nexusEventBus.emit('darwin.cycle', { hypothesis: cycle.hypothesis, outcome: 'proposed' });
                    return {
                        content: [{
                            type: 'text',
                            text: `🧬 Darwin Cycle Proposed Successfully\nID: ${cycle.id}\nWorktree Branch: ${cycle.worktreeBranch}\nStatus: ${cycle.outcome}\n\nProceed to implement and validate on this branch, then use nexus_darwin_review.`,
                        }],
                    };
                } catch (err: any) {
                    return {
                        content: [{
                            type: 'text',
                            text: `❌ Darwin Cycle Rejected: ${err.message}`,
                        }],
                    };
                }
            }

            case 'nexus_darwin_review': {
                const cycleId = String(request.params.arguments?.cycleId ?? '');
                const action = String(request.params.arguments?.action ?? 'defer') as 'apply' | 'reject' | 'defer';
                const learnings = Array.isArray(request.params.arguments?.learnings)
                    ? (request.params.arguments?.learnings as string[])
                    : [];

                try {
                    const updated = await darwinLoop.review(cycleId, action, learnings);
                    nexusEventBus.emit('darwin.cycle', { hypothesis: updated.hypothesis, outcome: updated.outcome });
                    return {
                        content: [{
                            type: 'text',
                            text: `🧬 Darwin Cycle ${cycleId} updated to: ${updated.outcome}.\nLearnings recorded: ${updated.learnings.length}`,
                        }],
                    };
                } catch (err: any) {
                    throw new McpError(ErrorCode.InvalidParams, err.message);
                }
            }

            case 'nexus_net_publish': {
                const type = String(request.params.arguments?.type ?? 'knowledge') as 'knowledge' | 'skill';
                const content = String(request.params.arguments?.content ?? '');
                const tags = Array.isArray(request.params.arguments?.tags) ? (request.params.arguments?.tags as string[]) : [];

                // Guardrail: GIST_PUBLISH_GUARD auto-check
                const guardCtx = { action: `nexusnet_transmit: ${content}` };
                const guardCheck = guardrailEngine.check(guardCtx);
                if (!guardCheck.passed) {
                    return {
                        content: [{
                            type: 'text',
                            text: `❌ GUARDRAIL BLOCKED: ${guardrailEngine.format(guardCheck)}`
                        }]
                    };
                }

                try {
                    const result = await nexusNetRelay.publish(type, { content, tags });
                    nexusEventBus.emit('nexusnet.publish', { type, byteSize: result.bytes });
                    return {
                        content: [{
                            type: 'text',
                            text: result.configured
                                ? `🌐 Published to NexusNet successfully.\nMessage ID: ${result.id}\nBytes: ${result.bytes}`
                                : `⚠️ NexusNet relay unconfigured.\nBuffered message ID: ${result.id}\nBytes: ${result.bytes}\nMode: ${result.mode}`,
                        }],
                    };
                } catch (err: any) {
                    return {
                        content: [{ type: 'text', text: `❌ NexusNet Publish Failed: ${err.message}` }],
                    };
                }
            }

            case 'nexus_net_sync': {
                try {
                    const messages = await nexusNetRelay.sync();
                    nexusEventBus.emit('nexusnet.sync', { newItemsCount: messages.length });

                    let text = `🌐 Synced with NexusNet. Found ${messages.length} new messages from other agents.\n`;
                    messages.forEach((m, i) => {
                        text += `\n[${i + 1}] Type: ${m.type} | Agent: ${m.sourceId}\nContent: ${m.payload.content}\nTags: ${m.payload.tags.join(', ')}\n`;
                    });

                    return {
                        content: [{ type: 'text', text }],
                    };
                } catch (err: any) {
                    return {
                        content: [{ type: 'text', text: `❌ NexusNet Sync Failed: ${err.message}` }],
                    };
                }
            }

            case 'nexus_decompose_task': {
                const goal = String(request.params.arguments?.goal ?? '');
                const steps = Array.isArray(request.params.arguments?.steps)
                    ? (request.params.arguments?.steps as string[])
                    : [];

                // Console ASCII UI
                const lines = [
                    `Goal: ${goal.replace(/\n/g, ' ').substring(0, 58).padEnd(60, ' ')}`,
                    '─'.repeat(66)
                ];
                steps.forEach((step, idx) => {
                    const prefix = idx === steps.length - 1 ? '└──' : '├──';
                    lines.push(`${prefix} ${step.substring(0, 62).padEnd(64, ' ')}`);
                });
                this.box('📋 TASK DECOMPOSITION', lines, '36');

                const text = `📋 Task Decomposed: ${goal}\n\n` + steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
                return { content: [{ type: 'text', text }] };
            }

            case 'nexus_request_affirmation': {
                const message = String(request.params.arguments?.message ?? '');
                const severity = String(request.params.arguments?.severity ?? 'warning');

                const color = severity === 'critical' ? '31' : '33'; // Red or Yellow
                const title = severity === 'critical' ? '🛑 CRITICAL AFFIRMATION REQUIRED' : '⚠️  AFFIRMATION REQUIRED';

                const messageLines: string[] = [];
                const words = message.split(' ');
                let line = '';
                for (const word of words) {
                    if (line.length + word.length + 1 > 64) {
                        messageLines.push(line);
                        line = word;
                    } else {
                        line += (line ? ' ' : '') + word;
                    }
                }
                if (line) {
                    messageLines.push(line);
                }
                messageLines.push('⏳ PAUSED: Waiting for human user to reply in chat...');

                this.box(title, messageLines, color);

                return { content: [{ type: 'text', text: `⏸️ PAUSED for affirmation.\nMessage: ${message}\nSeverity: ${severity}\n\nPlease ask the user in chat and wait for a response.` }] };
            }

            case 'nexus_assemble_context': {
                const files = Array.isArray(request.params.arguments?.files)
                    ? (request.params.arguments?.files as string[])
                    : [];
                const reason = String(request.params.arguments?.reason ?? '');

                const lines = [
                    `Reason: ${reason.replace(/\n/g, ' ').substring(0, 56).padEnd(58, ' ')}`,
                    '─'.repeat(66)
                ];
                files.forEach((file, idx) => {
                    const prefix = idx === files.length - 1 ? '└──' : '├──';
                    const displayPath = file.length > 62 ? '...' + file.substring(file.length - 59) : file;
                    lines.push(`${prefix} ${displayPath.padEnd(64, ' ')}`);
                });
                this.box('📂 CONTEXT ASSEMBLED', lines, '34');

                const text = `📂 Context Assembled. Reason: ${reason}\n\n` + files.map(f => `- ${f}`).join('\n');
                return { content: [{ type: 'text', text }] };
            }

            case 'nexus_entangle': {
                const systemId = String(request.params.arguments?.systemId ?? '');
                const agentId = String(request.params.arguments?.agentId ?? '');
                const basis = String(request.params.arguments?.basis ?? '');

                // Check if state exists, if not, create a GHZ state with mock partners
                let stateId = systemId;
                let state = entanglementEngine.getStates().find(s => s.id === systemId);

                if (!state) {
                    state = entanglementEngine.entangle([agentId, 'partner_beta', 'partner_gamma'], 4);
                    stateId = state.id;
                }

                const measurement = entanglementEngine.measure(stateId, agentId);
                if (!measurement) {
                    throw new McpError(ErrorCode.InternalError, "Failed to measure entangled state");
                }

                return {
                    content: [{
                        type: 'text',
                        text: `🔗 Entanglement Measurement\nSystem: ${stateId}\nAgent: ${agentId}\nBasis: ${basis}\nOutcome (Strategy): ${measurement.strategyIndex}\nProbability: ${(measurement.probability * 100).toFixed(2)}%`
                    }]
                };
            }

            case 'nexus_cas_compress': {
                const input = Array.isArray(request.params.arguments?.tokens) ? (request.params.arguments?.tokens as string[]).join(' ') : String(request.params.arguments?.tokens ?? '');
                const tokens = AttentionScorer.tokenize(input);
                if (tokens.length === 0) {
                    throw new McpError(ErrorCode.InvalidParams, "Tokens array cannot be empty");
                }

                const task = "mcp_compression_request";
                const encoding = casEngine.encode(tokens, task);

                // Trigger learning of the provided text as a pattern
                casEngine.learnPattern(tokens.join(' '), 1);

                return {
                    content: [{
                        type: 'text',
                        text: `🌊 CAS Compression Complete\nOriginal Tokens: ${tokens.length}\nCompressed Characters: ${encoding.compressed.length}\nCompression Ratio: ${encoding.compressionRatio.toFixed(2)}x`
                    }]
                };
            }

            case 'nexus_kv_bridge_status': {
                const metrics = kvBridge.getMetrics();
                const text = `🌉 KV Bridge Status\n` +
                    `Decisions: ${metrics.totalDecisions}\n` +
                    `Merge Rate: ${(metrics.mergeRate * 100).toFixed(1)}%\n` +
                    `Avg Compression: ${metrics.avgCompression.toFixed(2)}x\n` +
                    `Consensus Agents: ${metrics.consensusStats.agents}\n` +
                    `Consensus Conflicts: ${metrics.consensusStats.conflicts}`;

                return {
                    content: [{ type: 'text', text }]
                };
            }

            case 'nexus_kv_adapt': {
                const taskType = String(request.params.arguments?.taskType ?? '');

                const mockFeatures = Array.from({ length: 10 }, () => ({
                    layerDepth: 0.5,
                    magnitudeRatio: 1.2,
                    cosineSimilarity: 0.8,
                    entropy: 0.2,
                    taskEmbedding: [1.0, 0.5]
                }));

                const result = await kvBridge.adaptToTask(taskType, mockFeatures);

                return {
                    content: [{
                        type: 'text',
                        text: `🎯 FOMAML 10-Shot Adaptation\nTask: ${result.taskType}\nTime: ${result.adaptationTime}ms\nQuality Improvement: ${result.improvementPct.toFixed(1)}%`
                    }]
                };
            }

            case 'nexus_execute_nxl': {
                const goal = String(request.params.arguments?.goal ?? '');
                const useCase = String(request.params.arguments?.useCase ?? 'General');
                const nxlScript = String(request.params.arguments?.nxlScript ?? '');

                if (nxlScript) {
                    try {
                        nxl.parse(nxlScript);
                    } catch (e: any) {
                        return { content: [{ type: 'text', text: `❌ NXL Parse Error: ${e.message}` }] };
                    }
                }
                try {
                    const execution = await this.getRuntime().runNXL(goal, nxlScript || undefined, useCase);
                    const verifiedWorkers = execution.workerResults.filter(result => result.verified).length;

                    execution.activeSkills.forEach(skill => this.sessionDNA.recordSkill(skill.name));
                    execution.workerResults.forEach(result => {
                        result.modifiedFiles.forEach(file => this.sessionDNA.recordFileModified(file));
                    });
                    this.sessionDNA.recordDecision(
                        'NXL execution graph completed',
                        execution.result || summarizeExecution(execution),
                        execution.state === 'merged' ? 0.95 : execution.state === 'rolled_back' ? 0.5 : 0.28
                    );

                    this.nexusRef.storeMemory(
                        `NXL runtime: state=${execution.state}, workers=${execution.workerResults.length}, verified=${verifiedWorkers}, useCase=${useCase}`,
                        execution.state === 'merged' ? 0.94 : 0.74,
                        ['#nxl', '#decision', execution.state]
                    );

                    if (execution.finalDecision) {
                        await this.nexusRef.analyzeLearning(goal, execution.finalDecision);
                    }

                    this.box('🚀 NXL RUNTIME GRAPH', [
                        `Goal: ${goal.substring(0, 60).padEnd(60, ' ')}`,
                        `Run: ${execution.runId.padEnd(28, ' ')} State: ${execution.state.padEnd(18, ' ')}`,
                        `Workers: ${execution.workerResults.length.toString().padEnd(5, ' ')} Verified: ${verifiedWorkers.toString().padEnd(10, ' ')}`
                    ], execution.state === 'merged' ? '32' : execution.state === 'rolled_back' ? '33' : '31');

                    return {
                        content: [{
                            type: 'text',
                            text: [
                                `🚀 NXL Runtime — ${summarizeExecution(execution)}`,
                                '',
                                `Run ID: ${execution.runId}`,
                                `Use Case: ${useCase}`,
                                `Artifacts: ${execution.artifactsPath}`,
                                `Workers: ${execution.workerResults.length}`,
                                `Verified Workers: ${verifiedWorkers}`,
                                `Decision: ${execution.finalDecision?.action ?? 'none'}`,
                                `Planner: ${execution.plannerResult?.summary ?? 'n/a'}`,
                                `Backends: memory=${execution.selectedBackends.memoryBackend}, compression=${execution.selectedBackends.compressionBackend}, consensus=${execution.selectedBackends.consensusPolicy}, dsl=${execution.selectedBackends.dslCompiler}`,
                                `Active Skills: ${execution.activeSkills.length > 0 ? execution.activeSkills.map(skill => skill.name).join(', ') : 'none'}`,
                                `Active Workflows: ${execution.activeWorkflows.length > 0 ? execution.activeWorkflows.map(workflow => workflow.name).join(', ') : 'none'}`,
                                `Promotions: ${execution.promotionDecisions.length > 0 ? execution.promotionDecisions.map(decision => `${decision.kind}:${decision.target}:${decision.approved ? 'approved' : 'held'}`).join(', ') : 'none'}`,
                                '',
                                `Result: ${execution.result}`
                            ].join('\n')
                        }]
                    };
                } catch (e: any) {
                    return { content: [{ type: 'text', text: `❌ NXL Runtime Error: ${e.message}` }] };
                }
            }

            case 'nexus_publish_trace': {
                const taskId = String(request.params.arguments?.taskId ?? '');
                const goal = String(request.params.arguments?.goal ?? '');
                const findings = Array.isArray(request.params.arguments?.findings) ? request.params.arguments.findings as string[] : [];
                const confidence = Number(request.params.arguments?.confidence ?? 0.9);

                const trace: TraceEntry = { taskId, goal, findings, confidence, timestamp: Date.now() };
                const result = await federation.publishTrace(trace);

                return {
                    content: [{
                        type: 'text',
                        text: `🌐 Federated Trace Released!\nURL: ${result.url}\nID: ${result.id}\nTags: #federation, #gist, #trace`
                    }]
                };
            }
        }
    }


    scanSourceFiles(cwd: string): string[] {
        return this.walk(cwd).filter(f => f.endsWith('.ts') && !f.includes('node_modules') && !f.endsWith('.d.ts'));
    }

    private walk(dir: string): string[] {
        let results: string[] = [];
        try {
            const list = readdirSync(dir);
            for (const file of list) {
                const filePath = path.join(dir, file);
                const stat = statSync(filePath);
                if (stat && stat.isDirectory()) {
                    if (file !== 'node_modules' && file !== 'dist' && file !== '.git') {
                        results = results.concat(this.walk(filePath));
                    }
                } else {
                    results.push(filePath);
                }
            }
        } catch (e) { void e; }
        return results;
    }

    async connect(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        this.connected = true;
        console.error('[MCP Adapter] Connected — runtime tools active');
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

    async send(message: NetworkMessage): Promise<void> { void message; }
    receive(message: NetworkMessage): void { void message; }
}
