import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GuardrailEngine } from '../engines/guardrails-bridge.js';
import type { MemoryCheckResult, MemoryStats } from '../engines/memory.js';
import { MemoryEngine } from '../engines/memory.js';
import { SessionDNAManager } from '../engines/session-dna.js';
import {
    type BackendMode,
    type CompressionBackend,
    type CompressionShadow,
    type DSLCompilationResult,
    type DSLCompilerBackend,
    type MemoryBackend,
    buildRunId,
    createRuntimeBackendRegistry,
    normalizeReadingPlan,
    resolveBackend,
    type RuntimeBackendRegistry,
} from '../engines/runtime-backends.js';
import {
    SkillRuntime,
    createSkillRuntime,
    type SkillArtifact,
    type SkillRuntimeMetrics,
    type SkillBinding,
    type SkillCheckpoint,
} from '../engines/skill-runtime.js';
import {
    WorkflowRuntime,
    createWorkflowRuntime,
    type WorkflowArtifact,
} from '../engines/workflow-runtime.js';
import {
    HookRuntime,
    createHookRuntime,
    type HookArtifact,
} from '../engines/hook-runtime.js';
import {
    AutomationRuntime,
    createAutomationRuntime,
    type AutomationArtifact,
    type ConnectorBinding,
} from '../engines/automation-runtime.js';
import {
    SecurityShield,
    createSecurityShield,
    type ShieldDecision,
    type ShieldPolicyMode,
} from '../engines/security-shield.js';
import { FederationEngine, federation as defaultFederation } from '../engines/federation.js';
import { ByzantineConsensus } from '../engines/byzantine-consensus.js';
import { podNetwork } from '../engines/pod-network.js';
import {
    detectDomains,
    type HookTrigger,
    type SkillScope,
} from '../engines/runtime-assets.js';
import {
    getSpecialist,
    listCrewTemplates,
    listSpecialists,
    type ContinuationProposal,
    type FallbackPlan,
    type OptimizationProfile,
    type PlanningLedgerRow,
    type ReviewGateResult,
    type SelectedCrew,
    type SelectedSpecialist,
} from '../engines/specialist-roster.js';
import { planTask, type TaskPlannerState } from '../engines/task-planner.js';
import { nexusEventBus } from '../engines/event-bus.js';
import {
    RuntimeRegistry,
    createEmptyUsageState,
    createEmptyTokenSummary,
    type RuntimeClientInstructionStatus,
    type RuntimeRegistrySnapshot,
    type RuntimeOrchestrationSnapshot,
    type RuntimePrimaryClientSnapshot,
    type RuntimeSequenceComplianceSnapshot,
    type RuntimeTokenRunSnapshot,
    type RuntimeTokenSummarySnapshot,
    type RuntimeUsageCategory,
} from '../engines/runtime-registry.js';
import {
    InstructionGateway,
    createExecutionLedger,
    markExecutionLedgerStep,
    renderInstructionPacketMarkdown,
    type ExecutionLedger,
    type InstructionPacket,
    type OrchestrationExecutionMode,
} from '../engines/instruction-gateway.js';
import type { KnowledgeFabricBundle, KnowledgeFabricSnapshot } from '../engines/knowledge-fabric.js';
import { MergeOracle } from './merge-oracle.js';
import type { MergeDecision, WorkerResult } from './index.js';
import type { FileRef, ReadingPlan } from '../engines/token-supremacy.js';

const exec = promisify(execCallback);

export type ExecutionMode = 'real' | 'analysis';
export type ExecutionState =
    | 'planned'
    | 'bootstrapping'
    | 'running'
    | 'verifying'
    | 'merged'
    | 'rolled_back'
    | 'failed';

export type WorkerRole =
    | 'planner'
    | 'coder'
    | 'verifier'
    | 'skill-maker'
    | 'research-shadow';

export interface BackendSelection {
    memoryBackend: string;
    compressionBackend: string;
    consensusPolicy: string;
    dslCompiler: string;
}

export interface SkillPolicy {
    mode: 'guarded-hot' | 'session-only' | 'manual';
    allowMutateSkills: boolean;
}

export interface PromotionPolicy {
    autoPromoteSkills: boolean;
    autoPromoteWorkflows: boolean;
    globalThreshold: number;
}

export interface DerivationPolicy {
    mode: 'auto' | 'manual' | 'disabled';
}

export interface MemoryPolicy {
    mode: 'balanced' | 'strict' | 'off';
    quarantineTag: string;
}

export interface ReviewPolicy {
    mode: 'full' | 'runtime-only';
}

export interface ReleasePolicy {
    mode: 'ship-ready' | 'skip';
}

export interface ContinuationPolicy {
    mode: 'suggest' | 'manual';
}

export interface ExecutionTask {
    goal: string;
    files: string[];
    workers: number;
    roles: string[];
    strategies: string[];
    verifyCommands: string[];
    successCriteria: string[];
    rollbackPolicy: 'patch-revert';
    timeoutMs: number;
    skillPolicy: SkillPolicy;
    backendSelectors: Partial<BackendSelection>;
    skillNames: string[];
    workflowSelectors: string[];
    hookSelectors: string[];
    automationSelectors: string[];
    connectorBindings: ConnectorBinding[];
    actions: SkillBinding[];
    inlineSkills: SkillArtifact[];
    nxlScript?: string;
    promotionPolicy: PromotionPolicy;
    derivationPolicy: DerivationPolicy;
    checkpointPolicy: SkillCheckpoint[];
    backendMode: BackendMode;
    shieldPolicy: ShieldPolicyMode;
    memoryPolicy: MemoryPolicy;
    crewSelectors: string[];
    specialistSelectors: string[];
    optimizationProfile: OptimizationProfile;
    reviewPolicy: ReviewPolicy;
    releasePolicy: ReleasePolicy;
    continuationPolicy: ContinuationPolicy;
    parentRunId?: string;
    sourceAutomationId?: string;
    continuationDepth: number;
    suppressedAutomationIds: string[];
    allowedToolsOverride?: string[];
    executionMode: OrchestrationExecutionMode;
    manualOverrides: string[];
    instructionPacket?: InstructionPacket;
    executionLedger?: ExecutionLedger;
    knowledgeFabric?: KnowledgeFabricBundle;
}

export interface WorkerSkillOverlay {
    base: string[];
    session: string[];
    worker: string[];
    runtimeHot: string[];
}

export interface WorkerManifest {
    workerId: string;
    role: WorkerRole;
    strategy: string;
    worktreeDir: string | null;
    specialistId?: string;
    specialistName?: string;
    files: FileRef[];
    skillOverlays: WorkerSkillOverlay;
    workflowOverlays: string[];
    allowedTools: string[];
    tokenBudget: number;
    verifyCommands: string[];
    checkpoints: SkillCheckpoint[];
    actions: SkillBinding[];
    inlineSkills: SkillArtifact[];
    workflows: WorkflowArtifact[];
    context: WorkerContextPacket;
    targetWorkerId?: string;
}

export interface SpecialistContextPacket {
    specialistId?: string;
    name?: string;
    authority?: SelectedSpecialist['authority'];
    division?: string;
    mission?: string;
    rules: string[];
    workflow: string[];
    deliverables: string[];
}

export interface WorkflowContextPacket {
    workflowId: string;
    name: string;
    description: string;
    guardrails: string[];
    expectedOutputs: string[];
    steps: string[];
}

export interface WorkerPhasePacket {
    trigger: HookTrigger;
    notes: string[];
    addedSkillNames: string[];
    addedWorkflowNames: string[];
    addedBindings: string[];
}

export interface WorkerContextPacket {
    goal: string;
    runtimeId: string;
    runId: string;
    workerId: string;
    role: WorkerRole;
    strategy: string;
    selectedCrew?: SelectedCrew;
    specialist: SpecialistContextPacket;
    activeSkills: Array<{
        skillId: string;
        name: string;
        riskClass: SkillArtifact['riskClass'];
        scope: SkillScope;
        instructions: string;
        toolBindings: SkillBinding[];
    }>;
    activeWorkflows: WorkflowContextPacket[];
    reviewGates: ReviewGateResult[];
    continuation?: ContinuationProposal;
    phasePackets: WorkerPhasePacket[];
}

export interface CommandRecord {
    command: string;
    cwd: string;
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface WorkerVerification {
    workerId: string;
    verifierId: string;
    passed: boolean;
    commands: CommandRecord[];
    summary: string;
    artifactsPath: string;
}

export interface RuntimeWorkerResult extends WorkerResult {
    role: WorkerRole;
    verified: boolean;
    verification?: WorkerVerification;
    artifactsPath: string;
    modifiedFiles: string[];
}

export interface PlannerResult {
    summary: string;
    domains: string[];
    selectedFiles: string[];
    selectedWorkflows: string[];
    selectedSkills: string[];
    selectedTools: string[];
    selectedCrew?: SelectedCrew;
    selectedSpecialists: SelectedSpecialist[];
    fallbackPlan?: FallbackPlan;
    reviewGates: ReviewGateResult[];
    continuation?: ContinuationProposal;
    ledger: PlanningLedgerRow[];
    strategyMap: Array<{ workerId: string; strategy: string }>;
    risks: string[];
}

export interface BackendEvidence {
    notes: string[];
    memory: Record<string, unknown>;
    compression: Record<string, unknown> | CompressionShadow;
    consensus: Record<string, unknown>;
    dsl?: Record<string, unknown>;
    fallbacks: string[];
}

export interface PromotionDecision {
    kind: 'skill' | 'workflow' | 'backend' | 'hook' | 'automation';
    target: string;
    scope: SkillScope | 'backend';
    approved: boolean;
    rationale: string;
}

export interface ExecutionRun {
    runId: string;
    state: ExecutionState;
    mode: ExecutionMode;
    goal: string;
    parentRunId?: string;
    sourceAutomationId?: string;
    artifactsPath: string;
    workerManifests: WorkerManifest[];
    activeSkills: SkillArtifact[];
    activeWorkflows: WorkflowArtifact[];
    activeHooks: HookArtifact[];
    activeAutomations: AutomationArtifact[];
    selectedBackends: BackendSelection;
    finalDecision?: MergeDecision;
    workerResults: RuntimeWorkerResult[];
    plannerResult?: PlannerResult;
    verificationResults: WorkerVerification[];
    skillEvents: Array<Record<string, unknown>>;
    workflowEvents: Array<Record<string, unknown>>;
    hookEvents: Array<Record<string, unknown>>;
    automationEvents: Array<Record<string, unknown>>;
    backendEvidence: BackendEvidence;
    promotionDecisions: PromotionDecision[];
    shieldDecisions: ShieldDecision[];
    memoryChecks: MemoryCheckResult[];
    federationState?: unknown;
    artifactsIndex: Record<string, string>;
    result: string;
    plannerState?: TaskPlannerState;
    continuationChildren: Array<{ automationId: string; runId?: string; status: 'queued' | 'completed' | 'suppressed' | 'failed'; error?: string }>;
    tokenTelemetry?: RuntimeTokenRunSnapshot;
    instructionPacket?: InstructionPacket;
    executionLedger?: ExecutionLedger;
    knowledgeFabric?: KnowledgeFabricBundle;
}

export interface SubAgentRuntimeOptions {
    repoRoot?: string;
    memory?: MemoryEngine | MemoryBackend;
    compressionBackend?: CompressionBackend;
    dslCompiler?: DSLCompilerBackend;
    guardrails?: GuardrailEngine;
    sessionDNA?: SessionDNAManager;
    skillRuntime?: SkillRuntime;
    workflowRuntime?: WorkflowRuntime;
    hookRuntime?: HookRuntime;
    automationRuntime?: AutomationRuntime;
    securityShield?: SecurityShield;
    federation?: FederationEngine;
    artifactsRoot?: string;
}

class ArtifactRecorder {
    readonly runDir: string;
    readonly index: Record<string, string> = {};

    constructor(readonly runId: string, baseDir?: string) {
        const root = baseDir ?? path.join(os.tmpdir(), 'nexus-prime-runs');
        this.runDir = path.join(root, runId);
        fs.mkdirSync(this.runDir, { recursive: true });
    }

    workerDir(workerId: string): string {
        const dir = path.join(this.runDir, 'workers', workerId);
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    writeJson(relativePath: string, value: unknown): string {
        const target = path.join(this.runDir, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, JSON.stringify(value, null, 2), 'utf-8');
        this.index[relativePath] = target;
        return target;
    }

    writeText(relativePath: string, value: string): string {
        const target = path.join(this.runDir, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, value, 'utf-8');
        this.index[relativePath] = target;
        return target;
    }
}

class WorktreeSession {
    readonly worktreeDir: string;

    constructor(
        private repoRoot: string,
        private workerId: string,
        private role: WorkerRole,
        private recorder: ArtifactRecorder
    ) {
        this.worktreeDir = path.join(os.tmpdir(), 'nexus-prime-worktrees', `${role}-${workerId}`);
    }

    async create(): Promise<void> {
        fs.mkdirSync(path.dirname(this.worktreeDir), { recursive: true });
        await exec(`git worktree add --detach ${quote(this.worktreeDir)}`, {
            cwd: this.repoRoot,
            maxBuffer: 1024 * 1024 * 20,
        });
    }

    async run(command: string, allowFailure: boolean = false): Promise<CommandRecord> {
        return runCommand(this.worktreeDir, command, allowFailure);
    }

    async applyBindings(bindings: SkillBinding[]): Promise<string[]> {
        const modified = new Set<string>();

        for (const binding of bindings) {
            switch (binding.type) {
                case 'write_file': {
                    const filePath = this.resolve(binding.path || '');
                    fs.mkdirSync(path.dirname(filePath), { recursive: true });
                    fs.writeFileSync(filePath, binding.content ?? '', 'utf-8');
                    modified.add(relativeTo(this.worktreeDir, filePath));
                    break;
                }
                case 'append_file': {
                    const filePath = this.resolve(binding.path || '');
                    fs.mkdirSync(path.dirname(filePath), { recursive: true });
                    fs.appendFileSync(filePath, binding.content ?? '', 'utf-8');
                    modified.add(relativeTo(this.worktreeDir, filePath));
                    break;
                }
                case 'replace_text': {
                    const filePath = this.resolve(binding.path || '');
                    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
                    const updated = existing.replace(binding.search ?? '', binding.replace ?? '');
                    fs.mkdirSync(path.dirname(filePath), { recursive: true });
                    fs.writeFileSync(filePath, updated, 'utf-8');
                    modified.add(relativeTo(this.worktreeDir, filePath));
                    break;
                }
                case 'run_command': {
                    const record = await this.run(binding.command || '');
                    this.recorder.writeJson(path.join('workers', this.workerId, `${sanitizeFileName(record.command)}.json`), record);
                    break;
                }
            }
        }

        return [...modified];
    }

    async captureDiff(): Promise<string> {
        try {
            await exec('git add -A', {
                cwd: this.worktreeDir,
                maxBuffer: 1024 * 1024 * 20,
            });
            try {
                await exec('git reset HEAD -- .agent', {
                    cwd: this.worktreeDir,
                    maxBuffer: 1024 * 1024 * 20,
                });
            } catch {
                // Runtime skill overlays stay outside repo patches.
            }
            const { stdout } = await exec('git diff --binary --cached HEAD', {
                cwd: this.worktreeDir,
                maxBuffer: 1024 * 1024 * 20,
            });
            return stdout;
        } catch {
            return '';
        }
    }

    async applyPatchContent(diff: string): Promise<void> {
        if (!diff.trim()) return;
        const patchPath = path.join(this.recorder.workerDir(this.workerId), `${this.role}.patch`);
        fs.writeFileSync(patchPath, diff, 'utf-8');
        await exec(`git apply --whitespace=nowarn ${quote(patchPath)}`, {
            cwd: this.worktreeDir,
            maxBuffer: 1024 * 1024 * 20,
        });
    }

    async cleanup(): Promise<void> {
        try {
            await exec(`git worktree remove ${quote(this.worktreeDir)} --force`, {
                cwd: this.repoRoot,
                maxBuffer: 1024 * 1024 * 20,
            });
        } catch {
            // best effort
        }
    }

    private resolve(target: string): string {
        if (path.isAbsolute(target)) return target;
        return path.join(this.worktreeDir, target);
    }
}

class MergeMemoryAdapter {
    constructor(private readonly backend: MemoryBackend) { }

    async store(content: string, priority: number, tags: string[]): Promise<string> {
        return Promise.resolve(this.backend.store(content, priority, tags));
    }
}

class MultiTierConsensusPolicy {
    readonly descriptor = {
        kind: 'multi-tier-byzantine',
        mode: 'default' as const,
    };

    private localOracle: MergeOracle;
    private runConsensus = new ByzantineConsensus();
    private globalConsensus = new ByzantineConsensus();

    constructor(memory: MemoryBackend) {
        this.localOracle = new MergeOracle(new MergeMemoryAdapter(memory) as any);
    }

    registerAgents(agentIds: string[]): void {
        agentIds.forEach(id => {
            this.runConsensus.registerAgent(id);
            this.globalConsensus.registerAgent(id);
        });
    }

    async merge(results: RuntimeWorkerResult[]): Promise<MergeDecision> {
        return this.localOracle.merge(results as any);
    }

    approveRunLevelChange(agentIds: string[], delta: number[] = [1, 1, 1]): boolean {
        if (agentIds.length === 0) return false;
        this.registerAgents(agentIds);
        const result = this.runConsensus.autoConsensus(agentIds[0], 0, delta);
        return result.accepted;
    }

    approveGlobalPromotion(agentIds: string[], delta: number[] = [1, 1, 1]): boolean {
        if (agentIds.length === 0) return false;
        agentIds.forEach(id => this.globalConsensus.registerAgent(id));
        const result = this.globalConsensus.autoConsensus(agentIds[0], 1, delta);
        return result.accepted;
    }

    shadowStats(): Record<string, unknown> {
        return {
            runLevel: this.runConsensus.getStats(),
            global: this.globalConsensus.getStats(),
        };
    }
}

export class SubAgentRuntime {
    private repoRoot: string;
    private runtimeId: string;
    private startedAt: number;
    private defaultMemoryBackend: MemoryBackend;
    private memoryEngine?: MemoryEngine;
    private defaultCompressionBackend?: CompressionBackend;
    private defaultDslCompiler?: DSLCompilerBackend;
    private guardrails: GuardrailEngine;
    private sessionDNA?: SessionDNAManager;
    private skillRuntime: SkillRuntime;
    private workflowRuntime: WorkflowRuntime;
    private hookRuntime: HookRuntime;
    private automationRuntime: AutomationRuntime;
    private securityShield: SecurityShield;
    private federation: FederationEngine;
    private artifactsRoot?: string;
    private backendRegistry: RuntimeBackendRegistry;
    private runtimeRegistry: RuntimeRegistry;
    private runtimeSnapshot: RuntimeRegistrySnapshot;
    private runs = new Map<string, ExecutionRun>();
    private instructionGateway: InstructionGateway;

    constructor(options: SubAgentRuntimeOptions = {}) {
        this.repoRoot = options.repoRoot ?? process.cwd();
        this.runtimeId = buildRunId('runtime');
        this.startedAt = Date.now();
        const memoryLike = isMemoryBackend(options.memory)
            ? null
            : ((options.memory as MemoryEngine | undefined) ?? new MemoryEngine());
        this.memoryEngine = memoryLike ?? undefined;
        this.backendRegistry = createRuntimeBackendRegistry(memoryLike ?? {
            recall: (query: string, k?: number) => Promise.resolve((options.memory as MemoryBackend).recall(query, k)),
            store: (content: string, priority?: number, tags?: string[], parentId?: string, depth?: number) => String((options.memory as MemoryBackend).store(content, priority, tags, parentId, depth)),
            getStats: () => (options.memory as MemoryBackend).stats() as MemoryStats,
        });
        this.defaultMemoryBackend = isMemoryBackend(options.memory)
            ? options.memory
            : this.backendRegistry.memory.get('sqlite-memory')!;
        this.defaultCompressionBackend = options.compressionBackend;
        this.defaultDslCompiler = options.dslCompiler;
        if (isMemoryBackend(options.memory)) {
            this.backendRegistry.memory.set(options.memory.descriptor.kind, options.memory);
        }
        if (options.compressionBackend) {
            this.backendRegistry.compression.set(options.compressionBackend.descriptor.kind, options.compressionBackend);
        }
        if (options.dslCompiler) {
            this.backendRegistry.dsl.set(options.dslCompiler.descriptor.kind, options.dslCompiler);
        }
        this.guardrails = options.guardrails ?? new GuardrailEngine();
        this.sessionDNA = options.sessionDNA;
        this.skillRuntime = options.skillRuntime ?? createSkillRuntime(undefined, undefined, this.repoRoot);
        this.workflowRuntime = options.workflowRuntime ?? createWorkflowRuntime(undefined, this.repoRoot);
        this.hookRuntime = options.hookRuntime ?? createHookRuntime(undefined, this.repoRoot);
        this.automationRuntime = options.automationRuntime ?? createAutomationRuntime(undefined, this.repoRoot);
        this.securityShield = options.securityShield ?? createSecurityShield();
        this.federation = options.federation ?? defaultFederation;
        this.artifactsRoot = options.artifactsRoot;
        this.runtimeRegistry = new RuntimeRegistry();
        this.instructionGateway = new InstructionGateway(this.repoRoot);
        this.runtimeSnapshot = this.persistRuntimeSnapshot({
            runtimeId: this.runtimeId,
            pid: process.pid,
            cwd: this.repoRoot,
            entrypoint: 'sub-agent-runtime',
            startedAt: this.startedAt,
            lastHeartbeatAt: this.startedAt,
            lastActivityAt: this.startedAt,
            libraries: this.collectLibraryCounts(),
            usage: createEmptyUsageState(),
            executionMode: 'manual-low-level',
            plannerApplied: false,
            tokenOptimizationApplied: false,
            bootstrapCalled: false,
            orchestrateCalled: false,
            plannerCalled: false,
            skipReasons: [],
            lastToolCalls: [],
            sequenceCompliance: {
                status: 'idle',
                summary: 'No client tool sequence recorded yet.',
                updatedAt: this.startedAt,
            },
        });
    }

    async run(input: Partial<ExecutionTask> & { goal: string }): Promise<ExecutionRun> {
        const runId = buildRunId('exec');
        const recorder = new ArtifactRecorder(runId, this.artifactsRoot);
        let task = await this.normalizeTask(input);
        if (!task.executionLedger) {
            task.executionLedger = this.createManualLedger(task);
        }
        task.executionLedger.runId = runId;
        const planner = planTask(task);
        task = planner.task;
        task.executionLedger = task.executionLedger ?? this.createManualLedger(task);
        task.executionLedger.runId = runId;
        markExecutionLedgerStep(task.executionLedger, 'planner-selection', 'completed', {
            summary: `Planner selected ${planner.plannerState.selectedCrew?.name ?? 'baseline'} for runtime execution.`,
            details: {
                crew: planner.plannerState.selectedCrew?.crewId ?? null,
                specialists: planner.plannerState.selectedSpecialists.map((specialist) => specialist.specialistId),
            },
        });
        const backends = this.resolveBackends(task);
        const selectedBackends: BackendSelection = {
            memoryBackend: backends.memory.descriptor.kind,
            compressionBackend: backends.compression.descriptor.kind,
            consensusPolicy: 'multi-tier-byzantine',
            dslCompiler: backends.dsl.descriptor.kind,
        };

        const run: ExecutionRun = {
            runId,
            state: 'planned',
            mode: 'real',
            goal: task.goal,
            parentRunId: task.parentRunId,
            sourceAutomationId: task.sourceAutomationId,
            artifactsPath: recorder.runDir,
            workerManifests: [],
            activeSkills: [],
            activeWorkflows: [],
            activeHooks: [],
            activeAutomations: [],
            selectedBackends,
            workerResults: [],
            verificationResults: [],
            skillEvents: [],
            workflowEvents: [],
            hookEvents: [],
            automationEvents: [],
            backendEvidence: {
                notes: [],
                memory: {},
                compression: {},
                consensus: {},
                dsl: {},
                fallbacks: backends.fallbacks,
            },
            promotionDecisions: [],
            shieldDecisions: [],
            memoryChecks: [],
            artifactsIndex: recorder.index,
            result: '',
            plannerState: planner.plannerState,
            continuationChildren: [],
            instructionPacket: task.instructionPacket,
            executionLedger: task.executionLedger,
            knowledgeFabric: task.knowledgeFabric,
        };
        this.runs.set(runId, run);
        this.attachLatestRun(runId, task.goal, run.state);
        this.syncExecutionMetadata(run);

        recorder.writeJson('task.json', task);
        recorder.writeJson('planner-state.json', planner.plannerState);
        const memoryStats = backends.memory.selected.stats();
        if (task.executionMode === 'manual-low-level') {
            markExecutionLedgerStep(task.executionLedger, 'memory-stats', 'completed', {
                summary: `Runtime memory stats loaded (${memoryStats.cortex} cortex / ${memoryStats.hippocampus} hippocampus).`,
                details: {
                    prefrontal: memoryStats.prefrontal,
                    hippocampus: memoryStats.hippocampus,
                    cortex: memoryStats.cortex,
                    totalLinks: memoryStats.totalLinks,
                },
            });
        }
        this.markUsage('plan', {
            summary: `Planner selected ${planner.plannerState.selectedCrew?.name ?? 'baseline'} for ${task.goal}`,
            count: planner.plannerState.ledger.length,
        });
        this.markUsage('roster', {
            summary: `${planner.plannerState.selectedSpecialists.length} specialist(s) selected`,
            count: planner.plannerState.selectedSpecialists.length,
            details: planner.plannerState.selectedSpecialists.map((specialist) => specialist.name),
        });
        this.markUsage('crews', {
            summary: planner.plannerState.selectedCrew?.name ?? 'No crew selected',
            count: planner.plannerState.reviewGates.length,
            details: planner.plannerState.reviewGates.map((gate) => `${gate.gate}:${gate.status}`),
        });
        planner.plannerState.ledger.forEach((row) => {
            nexusEventBus.emit('planner.stage', {
                runId,
                stage: row.stage,
                status: row.status,
                owner: row.owner,
                assets: row.selectedAssets.length,
            });
        });
        this.sessionDNA?.recordDecision('Execution task accepted', task.goal, 0.8);
        const localPeer = this.federation.heartbeat(`runtime-${runId}`, {
            displayName: `Runtime ${runId}`,
            source: 'local',
            capabilities: ['runtime', 'skills', 'workflows', 'hooks', 'automations'],
            trust: 'high',
        });
        run.federationState = this.federation.getSnapshot();
        this.recordFederationUsage(
            Number((run.federationState as { activePeerLinks?: number })?.activePeerLinks ?? 0),
            Array.isArray((run.federationState as { knownPeers?: unknown[] })?.knownPeers) ? ((run.federationState as { knownPeers?: unknown[] }).knownPeers?.length ?? 0) : 0,
            Number((run.federationState as { tracesPublished?: number })?.tracesPublished ?? 0),
            ((run.federationState as { relay?: RuntimeRegistrySnapshot['federation']['relay'] })?.relay ?? { configured: false, mode: 'degraded' }),
        );
        recorder.writeJson('federation-bootstrap.json', { localPeer, snapshot: run.federationState });

        const guardAction = `execute: ${task.goal}; verify=${task.verifyCommands.join(', ')}`;
        const guardrail = this.guardrails.check({
            action: guardAction,
            filesToModify: task.files,
            tokenCount: 2500 + task.files.length * 300,
            isDestructive: false,
        });
        markExecutionLedgerStep(task.executionLedger, 'governance-preflight', guardrail.passed ? 'completed' : 'blocked', {
            summary: `Guardrail score ${guardrail.score}`,
            details: {
                passed: guardrail.passed,
                violations: guardrail.violations.map((violation) => violation.id),
            },
        });
        run.executionLedger = task.executionLedger;
        this.syncExecutionMetadata(run);
        recorder.writeJson('guardrail.json', guardrail);
        this.markUsage('governance', {
            summary: `Guardrail score ${guardrail.score}`,
            details: guardrail.violations.map((violation) => violation.id),
            count: guardrail.violations.length,
        });
        nexusEventBus.emit('guardrail.check', { action: guardAction, passed: guardrail.passed, score: guardrail.score });
        if (!guardrail.passed) {
            run.state = 'failed';
            run.mode = 'analysis';
            run.result = 'Guardrails blocked execution.';
            this.attachLatestRun(runId, task.goal, run.state);
            markExecutionLedgerStep(task.executionLedger, 'runtime-execution', 'failed', {
                reason: 'guardrail-blocked',
                summary: run.result,
            });
            run.executionLedger = task.executionLedger;
            this.syncExecutionMetadata(run);
            recorder.writeJson('run.json', run);
            return run;
        }

        run.state = 'bootstrapping';

        const fileRefs = task.files.length > 0
            ? this.resolveFileRefs(task.files)
            : this.discoverTargetFiles(task.goal, backends.compression.selected);
        markExecutionLedgerStep(task.executionLedger, 'candidate-file-discovery', 'completed', {
            summary: `${fileRefs.length} candidate file(s) routed into runtime bootstrap.`,
            details: {
                files: fileRefs.map((file) => file.path),
            },
        });
        const memoryMatches = await backends.memory.selected.recall(task.goal, 6);
        this.markUsage('memories', {
            summary: `Recalled ${memoryMatches.length} memory match(es) for ${task.goal}`,
            count: memoryMatches.length,
            details: memoryMatches.slice(0, 3),
        });
        if (task.executionMode === 'manual-low-level') {
            markExecutionLedgerStep(task.executionLedger, 'recall-memory', 'completed', {
                summary: `Runtime recalled ${memoryMatches.length} memory match(es).`,
                details: {
                    matches: memoryMatches.slice(0, 3),
                },
            });
        }
        const planResult = normalizeReadingPlan(backends.compression.selected.planFiles(task.goal, fileRefs));
        const plan = planResult.plan;
        markExecutionLedgerStep(task.executionLedger, 'token-optimization', 'completed', {
            summary: `Runtime selected ${plan.files.length} routed file(s).`,
            details: {
                totalEstimatedTokens: plan.totalEstimatedTokens,
                savings: plan.savings,
                files: plan.files.map((entry) => ({ path: entry.file.path, action: entry.action })),
            },
        });
        run.backendEvidence.memory = await (backends.memory.selected.shadowRecall?.(task.goal, 6) ?? Promise.resolve({ recalled: memoryMatches }));
        run.backendEvidence.compression = await backends.compression.selected.shadow(task.goal, fileRefs);
        run.backendEvidence.notes.push(...planResult.notes);
        nexusEventBus.emit('tokens.optimized', {
            savings: plan.savings,
            pct: plan.totalEstimatedTokens + plan.savings > 0
                ? Math.round((plan.savings / (plan.totalEstimatedTokens + plan.savings)) * 100)
                : 0,
            files: plan.files.length,
            inputTokens: plan.totalEstimatedTokens + plan.savings,
            outputTokens: plan.totalEstimatedTokens,
            compressionRatio: plan.totalEstimatedTokens > 0
                ? (plan.totalEstimatedTokens + plan.savings) / plan.totalEstimatedTokens
                : 0,
            runId,
            sessionId: this.runtimeSnapshot.orchestration?.sessionId,
            phase: 'runtime-bootstrap',
            subsystem: 'compression',
        });
        recorder.writeJson('reading-plan.json', plan);
        recorder.writeJson('memory-evidence.json', run.backendEvidence.memory);
        recorder.writeJson('compression-evidence.json', run.backendEvidence.compression);

        const goalMemoryCheck = this.memoryEngine?.checkContent(task.goal, {
            tags: ['#runtime-goal'],
            priority: 0.4,
        });
        if (goalMemoryCheck) {
            run.memoryChecks.push(goalMemoryCheck);
            recorder.writeJson('memory-check-goal.json', goalMemoryCheck);
        }

        const domainMatches = detectDomains(task.goal, [
            ...memoryMatches,
            ...task.skillNames,
            ...task.workflowSelectors,
            ...task.hookSelectors,
            ...task.automationSelectors,
        ]);
        const resolvedSkills = this.skillRuntime.resolveSkillSelectors(task.skillNames, task.goal);
        const generatedSkills = this.skillRuntime.generateRuntimeSkills(task.goal, task.workers, {
            goal: task.goal,
            workerCount: task.workers,
            memoryMatches,
            repeatedFailures: 0,
            sessionHints: domainMatches,
        });
        const derivedSkills = task.derivationPolicy.mode === 'disabled'
            ? []
            : this.skillRuntime.deriveFromSignals({
                goal: task.goal,
                workerCount: task.workers,
                memoryMatches,
                repeatedFailures: 0,
                sessionHints: domainMatches,
            });
        const resolvedHooks = this.hookRuntime.resolveHookSelectors(task.hookSelectors, task.goal);
        const activeHooks = dedupeHookArtifacts([
            ...resolvedHooks,
            ...this.hookRuntime.resolveHookSelectors(domainMatches, task.goal),
        ]);

        const resolvedWorkflows = this.workflowRuntime.resolveWorkflowSelectors(task.workflowSelectors, task.goal);
        const derivedWorkflows = task.derivationPolicy.mode === 'disabled'
            ? []
            : this.workflowRuntime.deriveFromSignals({
                goal: task.goal,
                memoryMatches,
                repeatedFailures: 0,
                sessionHints: domainMatches,
            });
        const preReadHooks = this.hookRuntime.dispatch('run.created', activeHooks, {
            goal: task.goal,
            allowMutateHooks: task.skillPolicy.allowMutateSkills,
        });
        const beforeReadHooks = this.hookRuntime.dispatch('before-read', activeHooks, {
            goal: task.goal,
            allowMutateHooks: task.skillPolicy.allowMutateSkills,
        });
        [...preReadHooks.events, ...beforeReadHooks.events]
            .filter((event) => event.type === 'hook.fired' || event.type === 'hook.blocked')
            .forEach((event) => {
                nexusEventBus.emit('hook.fire', {
                    hookId: String(event.hookId),
                    name: String(event.name),
                    trigger: String(event.trigger),
                    blocked: event.type === 'hook.blocked',
                });
            });
        run.hookEvents.push(...preReadHooks.events, ...beforeReadHooks.events);

        const activeSkills = dedupeSkillArtifacts([
            ...resolvedSkills,
            ...generatedSkills,
            ...derivedSkills,
            ...task.inlineSkills,
            ...this.skillRuntime.resolveSkillSelectors(
                dedupeStrings([...preReadHooks.skillSelectors, ...beforeReadHooks.skillSelectors]),
                task.goal,
            ),
        ]);
        const skillBindings = this.gatherSkillBindings(activeSkills, task.skillPolicy.allowMutateSkills);

        const activeWorkflows = dedupeWorkflowArtifacts([
            ...resolvedWorkflows,
            ...derivedWorkflows,
            ...this.workflowRuntime.resolveWorkflowSelectors(
                dedupeStrings([...preReadHooks.workflowSelectors, ...beforeReadHooks.workflowSelectors]),
                task.goal,
            ),
        ]);
        const workflowApplication = this.workflowRuntime.applyToTask(
            activeWorkflows,
            task.verifyCommands,
            [...task.actions, ...skillBindings, ...preReadHooks.toolBindings, ...beforeReadHooks.toolBindings],
        );
        const effectiveVerifyCommands = dedupeStrings(workflowApplication.verifyCommands);
        const effectiveActions = workflowApplication.actions;
        const activeAutomations = dedupeAutomationArtifacts([
            ...this.automationRuntime.resolveAutomationSelectors(task.automationSelectors, task.goal),
            ...this.automationRuntime.resolveAutomationSelectors(domainMatches, task.goal),
        ]);

        run.activeSkills = activeSkills;
        run.activeWorkflows = activeWorkflows;
        run.activeHooks = activeHooks;
        run.activeAutomations = activeAutomations;
        this.markUsage('skills', {
            summary: `${activeSkills.length} skill(s) active for ${task.goal}`,
            count: skillBindings.length,
            details: activeSkills.map((skill) => skill.name),
        });
        this.markUsage('workflows', {
            summary: `${activeWorkflows.length} workflow(s) active for ${task.goal}`,
            count: activeWorkflows.length,
            details: activeWorkflows.map((workflow) => workflow.name),
        });
        this.markUsage('hooks', {
            summary: `${activeHooks.length} hook(s) selected`,
            count: activeHooks.length,
            details: activeHooks.map((hook) => hook.name),
        });
        this.markUsage('automations', {
            summary: `${activeAutomations.length} automation(s) selected`,
            count: activeAutomations.length,
            details: activeAutomations.map((automation) => automation.name),
        });
        run.skillEvents = activeSkills.map((skill) => ({
            type: 'skill.selected',
            skillId: skill.skillId,
            name: skill.name,
            scope: skill.scope,
            riskClass: skill.riskClass,
            provenance: skill.provenance,
        }));
        run.workflowEvents = workflowApplication.events;
        run.hookEvents.push(...activeHooks.map((hook) => ({
            type: 'hook.selected',
            hookId: hook.hookId,
            name: hook.name,
            trigger: hook.trigger,
            scope: hook.scope,
        })));
        run.automationEvents = activeAutomations.map((automation) => ({
            type: 'automation.selected',
            automationId: automation.automationId,
            name: automation.name,
            triggerMode: automation.triggerMode,
            eventTrigger: automation.eventTrigger,
            scope: automation.scope,
        }));
        recorder.writeJson('skills.json', activeSkills);
        recorder.writeJson('workflows.json', activeWorkflows);
        recorder.writeJson('hooks.json', activeHooks);
        recorder.writeJson('automations.json', activeAutomations);

        const manifests = this.createWorkerManifests(task, fileRefs, plan, activeSkills, activeWorkflows, effectiveActions, effectiveVerifyCommands, planner.plannerState);
        manifests.forEach((manifest) => {
            manifest.context = this.buildWorkerContext(runId, task, manifest, activeSkills, activeWorkflows, planner.plannerState);
        });
        run.workerManifests = manifests;
        run.plannerResult = this.createPlannerResult(task, manifests, fileRefs, domainMatches, planner.plannerState);
        recorder.writeJson('planner-result.json', run.plannerResult);
        recorder.writeJson('manifests.json', manifests);
        this.writeManifestContexts(recorder, manifests);

        const consensusPolicy = new MultiTierConsensusPolicy(backends.memory.selected);
        consensusPolicy.registerAgents(manifests.map((m) => m.workerId));
        run.backendEvidence.consensus = consensusPolicy.shadowStats();

        const beforeMutateHooks = this.hookRuntime.dispatch('before-mutate', activeHooks, {
            goal: task.goal,
            allowMutateHooks: task.skillPolicy.allowMutateSkills,
        });
        beforeMutateHooks.events.forEach((event) => {
            nexusEventBus.emit('hook.fire', {
                hookId: String(event.hookId),
                name: String(event.name),
                trigger: String(event.trigger),
                blocked: event.type === 'hook.blocked',
            });
        });
        run.hookEvents.push(...beforeMutateHooks.events);
        if (beforeMutateHooks.blocked) {
            run.state = 'failed';
            run.result = 'Hooks blocked execution before mutation.';
            this.attachLatestRun(runId, task.goal, run.state);
            recorder.writeJson('run.json', run);
            return run;
        }
        const beforeMutateResolved = this.applyPhaseHookEffects(
            runId,
            task,
            'before-mutate',
            beforeMutateHooks,
            run,
            manifests,
            {
                verifyCommands: effectiveVerifyCommands,
                actions: effectiveActions,
                events: workflowApplication.events,
            },
        );
        recorder.writeJson('manifests.json', manifests);
        recorder.writeJson('skills.json', run.activeSkills);
        recorder.writeJson('workflows.json', run.activeWorkflows);
        this.writeManifestContexts(recorder, manifests);

        run.state = 'running';
        const coderManifests = manifests.filter((manifest) => manifest.role === 'coder');
        const coderResults = await Promise.all(coderManifests.map((manifest) => this.runCoderWorker(runId, recorder, manifest)));
        run.workerResults = coderResults;
        recorder.writeJson('worker-results.json', coderResults);

        const beforeVerifyHooks = this.hookRuntime.dispatch('before-verify', activeHooks, {
            goal: task.goal,
            allowMutateHooks: task.skillPolicy.allowMutateSkills,
        });
        beforeVerifyHooks.events.forEach((event) => {
            nexusEventBus.emit('hook.fire', {
                hookId: String(event.hookId),
                name: String(event.name),
                trigger: String(event.trigger),
                blocked: event.type === 'hook.blocked',
            });
        });
        run.hookEvents.push(...beforeVerifyHooks.events);
        const beforeVerifyResolved = this.applyPhaseHookEffects(
            runId,
            task,
            'before-verify',
            beforeVerifyHooks,
            run,
            manifests,
            {
                verifyCommands: beforeMutateResolved.verifyCommands,
                actions: beforeMutateResolved.actions,
                events: workflowApplication.events,
            },
        );
        recorder.writeJson('manifests.json', manifests);
        recorder.writeJson('skills.json', run.activeSkills);
        recorder.writeJson('workflows.json', run.activeWorkflows);
        this.writeManifestContexts(recorder, manifests);

        run.state = 'verifying';
        const verifierManifests = manifests.filter((manifest) => manifest.role === 'verifier');
        const verificationResults = await Promise.all(verifierManifests.map((manifest) => {
            manifest.verifyCommands = beforeVerifyResolved.verifyCommands;
            return this.runVerifierWorker(runId, recorder, manifest, coderResults.find((result) => result.workerId === manifest.targetWorkerId));
        }));
        run.verificationResults = verificationResults;
        recorder.writeJson('verification-results.json', verificationResults);

        for (const result of run.workerResults) {
            const verification = verificationResults.find((entry) => entry.workerId === result.workerId);
            if (verification) {
                result.verification = verification;
                result.verified = verification.passed;
                result.testsPassing = verification.commands.filter((command) => command.exitCode === 0).length;
                result.outcome = verification.passed ? 'success' : (result.diff.trim() ? 'partial' : 'failed');
            }
        }

        const decision = await consensusPolicy.merge(run.workerResults);
        run.finalDecision = decision;
        run.backendEvidence.consensus = consensusPolicy.shadowStats();
        recorder.writeJson('decision.json', decision);

        nexusEventBus.emit('phantom.merge', {
            action: decision.action,
            winner: decision.winner?.workerId ?? decision.recommendedStrategy,
        });

        const preApplyShield = this.securityShield.evaluate({
            stage: 'apply',
            target: `run:${runId}`,
            policy: task.shieldPolicy,
            text: [decision.synthesized ?? '', ...run.workerResults.map((result) => result.diff)],
            domains: domainMatches,
            verified: run.workerResults.some((result) => result.verified),
            bindings: beforeVerifyResolved.actions,
            connectors: task.connectorBindings,
        });
        run.shieldDecisions.push(preApplyShield);
        recorder.writeJson('shield-apply.json', preApplyShield);
        nexusEventBus.emit('shield.decision', {
            target: preApplyShield.target,
            stage: preApplyShield.stage,
            action: preApplyShield.action,
            blocked: preApplyShield.blocked,
        });

        const reviewGates = this.evaluateReviewGates(run);
        run.plannerState = run.plannerState
            ? { ...run.plannerState, reviewGates }
            : run.plannerState;
        run.plannerResult = run.plannerResult
            ? { ...run.plannerResult, reviewGates }
            : run.plannerResult;
        const blockingGate = reviewGates.find((gate) => gate.status !== 'ready');

        const applied = preApplyShield.blocked
            ? { applied: false, rolledBack: false, summary: preApplyShield.summary }
            : blockingGate
                ? { applied: false, rolledBack: false, summary: `Review gate ${blockingGate.gate} remains ${blockingGate.status}.` }
                : await this.applyDecision(recorder, { ...task, verifyCommands: beforeVerifyResolved.verifyCommands }, decision, consensusPolicy);
        run.state = applied.applied
            ? (applied.rolledBack ? 'rolled_back' : 'merged')
            : 'failed';
        run.result = applied.summary;
        this.attachLatestRun(runId, task.goal, run.state);

        const resultMemoryCheck = this.memoryEngine?.checkContent(run.result, {
            tags: ['#runtime-result'],
            priority: applied.applied ? 0.78 : 0.55,
        });
        if (resultMemoryCheck) {
            run.memoryChecks.push(resultMemoryCheck);
            recorder.writeJson('memory-check-result.json', resultMemoryCheck);
        }

        const promotionDecisions = this.evaluatePromotions(run, consensusPolicy);
        run.promotionDecisions = promotionDecisions;
        recorder.writeJson('promotions.json', promotionDecisions);
        const completionTrigger: HookTrigger = run.state === 'merged' ? 'run.verified' : 'run.failed';
        const completionHooks = this.hookRuntime.dispatch(completionTrigger, activeHooks, {
            goal: task.goal,
            allowMutateHooks: task.skillPolicy.allowMutateSkills,
        });
        completionHooks.events.forEach((event) => {
            nexusEventBus.emit('hook.fire', {
                hookId: String(event.hookId),
                name: String(event.name),
                trigger: String(event.trigger),
                blocked: event.type === 'hook.blocked',
            });
        });
        run.hookEvents.push(...completionHooks.events);
        if (completionHooks.events.length > 0) {
            this.markUsage('hooks', {
                summary: `${completionTrigger} emitted ${completionHooks.events.length} hook event(s)`,
                count: completionHooks.events.length,
                details: completionHooks.events.map((event) => String(event.name ?? event.hookId ?? completionTrigger)),
            });
        }
        const automationDispatches = await this.automationRuntime.dispatch(completionTrigger, activeAutomations, {
            goal: task.goal,
            executeConnectors: true,
            payload: {
                runId,
                state: run.state,
                result: run.result,
            },
        });
        automationDispatches.forEach((dispatch) => {
            nexusEventBus.emit('automation.run', {
                automationId: dispatch.automationId,
                trigger: dispatch.trigger,
                queued: Boolean(dispatch.queuedRun),
            });
        });
        run.automationEvents.push(...automationDispatches.map((dispatch) => ({
            type: 'automation.dispatched',
            automationId: dispatch.automationId,
            name: dispatch.name,
            trigger: dispatch.trigger,
            queuedRun: dispatch.queuedRun,
            deliveries: dispatch.deliveries,
        })));
        if (automationDispatches.length > 0) {
            this.markUsage('automations', {
                summary: `${completionTrigger} dispatched ${automationDispatches.length} automation(s)`,
                count: automationDispatches.length,
                details: automationDispatches.map((dispatch) => dispatch.name),
            });
        }
        await this.executeAutomationContinuations(run, automationDispatches, task);
        run.federationState = this.federation.getSnapshot();
        this.recordFederationUsage(
            Number((run.federationState as { activePeerLinks?: number })?.activePeerLinks ?? 0),
            Array.isArray((run.federationState as { knownPeers?: unknown[] })?.knownPeers) ? ((run.federationState as { knownPeers?: unknown[] }).knownPeers?.length ?? 0) : 0,
            Number((run.federationState as { tracesPublished?: number })?.tracesPublished ?? 0),
            ((run.federationState as { relay?: RuntimeRegistrySnapshot['federation']['relay'] })?.relay ?? { configured: false, mode: 'degraded' }),
        );
        recorder.writeJson('federation-final.json', run.federationState);
        if (this.memoryEngine) {
            const audit = this.memoryEngine.audit(40);
            nexusEventBus.emit('memory.audit', {
                scanned: audit.scanned,
                quarantined: audit.quarantined.length,
            });
            this.markUsage('governance', {
                summary: `Memory audit scanned ${audit.scanned} entries`,
                count: audit.quarantined.length,
            });
        }
        run.tokenTelemetry = this.buildRunTokenTelemetry(run, plan, memoryMatches);
        this.recordRunTokenTelemetry(run.tokenTelemetry);
        markExecutionLedgerStep(task.executionLedger, 'runtime-execution', run.state === 'failed' ? 'failed' : 'completed', {
            summary: run.result,
            details: {
                state: run.state,
                verifiedWorkers: run.workerResults.filter((worker) => worker.verified).length,
            },
        });
        if (task.executionMode === 'manual-low-level') {
            markExecutionLedgerStep(task.executionLedger, 'structured-learning', 'skipped', {
                reason: 'manual-low-level',
                summary: 'Structured learning remains a caller responsibility for low-level runs.',
            });
        }
        run.executionLedger = task.executionLedger;
        this.syncExecutionMetadata(run);
        recorder.writeJson('token-telemetry.json', run.tokenTelemetry);
        recorder.writeJson('planner-state.json', run.plannerState);
        recorder.writeJson('planner-result.json', run.plannerResult);
        recorder.writeJson('manifests.json', run.workerManifests);
        recorder.writeJson('run.json', run);
        this.sessionDNA?.recordDecision('Execution completed', applied.summary, applied.applied ? 0.86 : 0.42);

        return run;
    }

    async runNXL(goal: string, rawScript?: string, useCase?: string): Promise<ExecutionRun> {
        const parsed = rawScript ? (this.backendRegistry.dsl.get('deterministic-nxl-compiler')?.compile(goal, rawScript, useCase).raw ?? {}) : {};
        const requestedCompiler = String((parsed as Record<string, unknown>).dslCompiler ?? (parsed as Record<string, unknown>).compiler ?? '');
        const resolution = resolveBackend(this.backendRegistry.dsl, requestedCompiler || this.defaultDslCompiler?.descriptor.kind, 'deterministic-nxl-compiler');
        const compiled = resolution.selected.compile(goal, rawScript, useCase);
        const run = await this.run(this.executionTaskFromCompiled(compiled, rawScript));
        run.backendEvidence.dsl = {
            compiler: resolution.descriptor.kind,
            notes: compiled.notes ?? [],
            archetypes: compiled.archetypes.map((archetype) => archetype.name),
        };
        this.runs.set(run.runId, run);
        return run;
    }

    listRuns(limit: number = 10): ExecutionRun[] {
        const persisted = this.loadPersistedRuns(limit * 2);
        const combined = new Map<string, ExecutionRun>();

        for (const run of persisted) {
            combined.set(run.runId, run);
        }
        for (const run of this.runs.values()) {
            combined.set(run.runId, run);
        }

        return [...combined.values()]
            .sort((a, b) => {
                const left = extractRunTimestamp(a);
                const right = extractRunTimestamp(b);
                return right - left;
            })
            .slice(0, limit);
    }

    getRun(runId: string): ExecutionRun | undefined {
        const existing = this.runs.get(runId);
        if (existing) return existing;

        const target = path.join(this.resolveArtifactsRoot(), runId, 'run.json');
        if (!fs.existsSync(target)) {
            return undefined;
        }

        try {
            const run = JSON.parse(fs.readFileSync(target, 'utf8')) as ExecutionRun;
            this.runs.set(runId, run);
            return run;
        } catch {
            return undefined;
        }
    }

    getRuntimeId(): string {
        return this.runtimeId;
    }

    getUsageSnapshot(): RuntimeRegistrySnapshot {
        return this.runtimeSnapshot;
    }

    getInstructionPacket(): InstructionPacket | undefined {
        return this.runtimeSnapshot.instructionPacket;
    }

    getExecutionLedger(): ExecutionLedger | undefined {
        return this.runtimeSnapshot.executionLedger;
    }

    getKnowledgeFabricSnapshot(): KnowledgeFabricSnapshot | undefined {
        return this.runtimeSnapshot.knowledgeFabric;
    }

    getTokenTelemetrySummary(): RuntimeTokenSummarySnapshot {
        return this.runtimeSnapshot.tokens ?? createEmptyTokenSummary();
    }

    getTokenTelemetryTimeline(limit: number = 20): RuntimeTokenRunSnapshot[] {
        return (this.runtimeSnapshot.tokens?.timeline ?? []).slice(0, Math.max(1, limit));
    }

    getTokenTelemetryForRun(runId: string): RuntimeTokenRunSnapshot | undefined {
        return this.getRun(runId)?.tokenTelemetry
            ?? (this.runtimeSnapshot.tokens?.timeline ?? []).find((entry) => entry.runId === runId);
    }

    recordOrchestrationSnapshot(snapshot: RuntimeOrchestrationSnapshot): RuntimeRegistrySnapshot {
        return this.persistRuntimeSnapshot({
            orchestration: snapshot,
            lastHeartbeatAt: Date.now(),
            lastActivityAt: Date.now(),
        });
    }

    recordKnowledgeFabricSnapshot(snapshot: KnowledgeFabricSnapshot | undefined): RuntimeRegistrySnapshot {
        return this.persistRuntimeSnapshot({
            knowledgeFabric: snapshot,
            lastHeartbeatAt: Date.now(),
            lastActivityAt: Date.now(),
        });
    }

    recordPrimaryClient(snapshot: RuntimePrimaryClientSnapshot | undefined, detected: RuntimePrimaryClientSnapshot[] = []): RuntimeRegistrySnapshot {
        return this.persistRuntimeSnapshot({
            clients: {
                primary: snapshot,
                detected,
                lastUpdatedAt: Date.now(),
            },
            clientId: snapshot?.clientId,
            clientFamily: snapshot?.clientFamily,
            lastHeartbeatAt: Date.now(),
            lastActivityAt: Date.now(),
        });
    }

    recordClientInstructionStatus(status: RuntimeClientInstructionStatus): RuntimeRegistrySnapshot {
        return this.persistRuntimeSnapshot({
            clientInstructionStatus: status,
            lastHeartbeatAt: Date.now(),
            lastActivityAt: Date.now(),
        });
    }

    recordClientToolCall(
        toolName: string,
        options: {
            bootstrapCalled?: boolean;
            orchestrateCalled?: boolean;
            plannerCalled?: boolean;
            tokenOptimizationApplied?: boolean;
            toolProfile?: 'autonomous' | 'full';
            instructionFiles?: string[];
        } = {},
    ): RuntimeRegistrySnapshot {
        const existingCalls = this.runtimeSnapshot.lastToolCalls ?? [];
        const lastToolCalls = [...existingCalls, toolName].slice(-12);
        const client = this.runtimeSnapshot.clients?.primary;
        const toolProfile = options.toolProfile ?? this.runtimeSnapshot.clientInstructionStatus?.toolProfile ?? 'autonomous';
        return this.persistRuntimeSnapshot({
            lastToolCalls,
            bootstrapCalled: options.bootstrapCalled ?? this.runtimeSnapshot.bootstrapCalled ?? false,
            orchestrateCalled: options.orchestrateCalled ?? this.runtimeSnapshot.orchestrateCalled ?? false,
            plannerCalled: options.plannerCalled ?? this.runtimeSnapshot.plannerCalled ?? false,
            tokenOptimizationApplied: options.tokenOptimizationApplied ?? this.runtimeSnapshot.tokenOptimizationApplied ?? false,
            clientInstructionStatus: {
                clientId: client?.clientId ?? this.runtimeSnapshot.clientId,
                clientFamily: client?.clientFamily ?? this.runtimeSnapshot.clientFamily,
                toolProfile,
                status: toolProfile === 'autonomous' ? 'guided' : 'manual',
                summary: toolProfile === 'autonomous'
                    ? 'Autonomous MCP profile active. Prefer nexus_session_bootstrap then nexus_orchestrate.'
                    : 'Full MCP profile active. Low-level and diagnostic tools are exposed.',
                instructionFiles: options.instructionFiles ?? this.runtimeSnapshot.clientInstructionStatus?.instructionFiles,
                updatedAt: Date.now(),
            },
            lastHeartbeatAt: Date.now(),
            lastActivityAt: Date.now(),
        });
    }

    recordInstructionPacket(
        packet: InstructionPacket | undefined,
        options: {
            executionMode?: OrchestrationExecutionMode;
            plannerApplied?: boolean;
            tokenOptimizationApplied?: boolean;
        } = {},
    ): RuntimeRegistrySnapshot {
        const primary = this.runtimeSnapshot.clients?.primary;
        return this.persistRuntimeSnapshot({
            instructionPacket: packet,
            instructionPacketHash: packet?.packetHash,
            executionMode: options.executionMode ?? this.runtimeSnapshot.executionMode ?? 'manual-low-level',
            plannerApplied: options.plannerApplied ?? this.runtimeSnapshot.plannerApplied ?? false,
            tokenOptimizationApplied: options.tokenOptimizationApplied ?? this.runtimeSnapshot.tokenOptimizationApplied ?? false,
            clientId: primary?.clientId ?? packet?.client?.clientId ?? this.runtimeSnapshot.clientId,
            clientFamily: primary?.clientFamily ?? packet?.client?.family ?? this.runtimeSnapshot.clientFamily,
            lastHeartbeatAt: Date.now(),
            lastActivityAt: Date.now(),
        });
    }

    recordExecutionLedger(
        ledger: ExecutionLedger | undefined,
        executionMode?: OrchestrationExecutionMode,
    ): RuntimeRegistrySnapshot {
        return this.persistRuntimeSnapshot({
            executionLedger: ledger,
            executionMode: executionMode ?? ledger?.executionMode ?? this.runtimeSnapshot.executionMode ?? 'manual-low-level',
            plannerApplied: ledger?.plannerApplied ?? this.runtimeSnapshot.plannerApplied ?? false,
            tokenOptimizationApplied: ledger?.tokenOptimizationApplied ?? this.runtimeSnapshot.tokenOptimizationApplied ?? false,
            lastHeartbeatAt: Date.now(),
            lastActivityAt: Date.now(),
        });
    }

    updateExecutionMetadata(runId: string, patch: {
        instructionPacket?: InstructionPacket;
        executionLedger?: ExecutionLedger;
        knowledgeFabric?: KnowledgeFabricBundle;
    }): ExecutionRun | undefined {
        const run = this.runs.get(runId);
        if (!run) return undefined;
        if (patch.instructionPacket !== undefined) {
            run.instructionPacket = patch.instructionPacket;
        }
        if (patch.executionLedger !== undefined) {
            run.executionLedger = patch.executionLedger;
        }
        if (patch.knowledgeFabric !== undefined) {
            run.knowledgeFabric = patch.knowledgeFabric;
        }
        this.syncExecutionMetadata(run);
        return run;
    }

    listSkills(): SkillArtifact[] {
        return this.skillRuntime.listArtifacts();
    }

    listWorkflows(): WorkflowArtifact[] {
        return this.workflowRuntime.listArtifacts();
    }

    listHooks(): HookArtifact[] {
        return this.hookRuntime.listArtifacts();
    }

    listAutomations(): AutomationArtifact[] {
        return this.automationRuntime.listArtifacts();
    }

    listSpecialists() {
        return listSpecialists();
    }

    listCrews() {
        return listCrewTemplates();
    }

    async planExecution(input: Partial<ExecutionTask> & { goal: string }): Promise<TaskPlannerState> {
        const task = await this.normalizeTask(input);
        const planner = planTask(task).plannerState;
        this.persistRuntimeSnapshot({
            plannerCalled: true,
            plannerApplied: true,
            lastHeartbeatAt: Date.now(),
            lastActivityAt: Date.now(),
        });
        this.markUsage('plan', {
            summary: `Planner prepared ${planner.selectedCrew?.name ?? 'baseline'} for ${task.goal}`,
            count: planner.ledger.length,
        });
        this.markUsage('roster', {
            summary: `${planner.selectedSpecialists.length} specialists selected`,
            count: planner.selectedSpecialists.length,
        });
        this.markUsage('crews', {
            summary: planner.selectedCrew?.name ?? 'No crew selected',
            count: planner.reviewGates.length,
        });
        planner.ledger.forEach((row) => {
            nexusEventBus.emit('planner.stage', {
                stage: row.stage,
                status: row.status,
                owner: row.owner,
                assets: row.selectedAssets.length,
            });
        });
        return planner;
    }

    generateSkill(input: { name: string; instructions: string; riskClass?: SkillArtifact['riskClass']; scope?: SkillScope; provenance?: string }): SkillArtifact {
        return this.skillRuntime.createSkill({
            name: input.name,
            instructions: input.instructions,
            toolBindings: [],
            riskClass: input.riskClass ?? 'orchestrate',
            scope: input.scope ?? 'session',
            provenance: input.provenance ?? 'mcp:generate',
        });
    }

    deploySkill(skillId: string, scope: SkillScope = 'session'): SkillArtifact | undefined {
        return this.skillRuntime.promote(skillId, scope);
    }

    revokeSkill(skillId: string): SkillArtifact | undefined {
        return this.skillRuntime.revoke(skillId);
    }

    generateWorkflow(input: { name: string; description: string; domain?: string; scope?: SkillScope }): WorkflowArtifact {
        return this.workflowRuntime.createWorkflow({
            name: input.name,
            domain: input.domain ?? detectDomains(input.name)[0] ?? 'workflows',
            description: input.description,
            triggerConditions: ['manual generation'],
            expectedOutputs: ['workflow artifact'],
            guardrails: ['Validate before promotion.'],
            verifierHooks: [],
            roleAffinity: ['planner', 'coder', 'verifier'],
            steps: [
                { title: 'Plan the workflow scope', checkpoint: 'before-read', role: 'planner', bindings: [] },
                { title: 'Execute the workflow body', checkpoint: 'before-mutate', role: 'coder', bindings: [] },
                { title: 'Verify the workflow outcome', checkpoint: 'before-verify', role: 'verifier', bindings: [] },
            ],
            scope: input.scope ?? 'session',
            provenance: 'mcp:generate',
        });
    }

    deployWorkflow(workflowId: string, scope: SkillScope = 'session'): WorkflowArtifact | undefined {
        return this.workflowRuntime.deploy(workflowId, buildRunId('workflow-deploy'), scope);
    }

    revokeWorkflow(workflowId: string): WorkflowArtifact | undefined {
        return this.workflowRuntime.revoke(workflowId);
    }

    generateHook(input: { name: string; description: string; trigger: HookTrigger; riskClass?: HookArtifact['riskClass']; scope?: SkillScope }): HookArtifact {
        return this.hookRuntime.createHook({
            name: input.name,
            description: input.description,
            domain: detectDomains(`${input.name} ${input.description}`)[0],
            trigger: input.trigger,
            conditions: ['manual generation'],
            guardrails: ['Validate before promotion.'],
            skillSelectors: [],
            workflowSelectors: [],
            toolBindings: [],
            riskClass: input.riskClass ?? 'orchestrate',
            scope: input.scope ?? 'session',
            provenance: 'mcp:generate',
        });
    }

    deployHook(hookId: string, scope: SkillScope = 'session'): HookArtifact | undefined {
        return this.hookRuntime.deploy(hookId, scope);
    }

    revokeHook(hookId: string): HookArtifact | undefined {
        return this.hookRuntime.revoke(hookId);
    }

    generateAutomation(input: {
        name: string;
        description: string;
        triggerMode?: AutomationArtifact['triggerMode'];
        eventTrigger?: HookTrigger;
        scope?: SkillScope;
        workflowSelectors?: string[];
        hookSelectors?: string[];
        skillSelectors?: string[];
        connectors?: ConnectorBinding[];
    }): AutomationArtifact {
        return this.automationRuntime.createAutomation({
            name: input.name,
            description: input.description,
            domain: detectDomains(`${input.name} ${input.description}`)[0],
            triggerMode: input.triggerMode ?? 'event',
            eventTrigger: input.eventTrigger,
            workflowSelectors: input.workflowSelectors ?? [],
            hookSelectors: input.hookSelectors ?? [],
            skillSelectors: input.skillSelectors ?? [],
            connectors: input.connectors ?? [],
            scope: input.scope ?? 'session',
            provenance: 'mcp:generate',
        });
    }

    deployAutomation(automationId: string, scope: SkillScope = 'session'): AutomationArtifact | undefined {
        return this.automationRuntime.deploy(automationId, scope);
    }

    revokeAutomation(automationId: string): AutomationArtifact | undefined {
        return this.automationRuntime.revoke(automationId);
    }

    async runAutomation(automationId: string, goal?: string): Promise<ExecutionRun> {
        const automation = this.automationRuntime.getArtifact(automationId) ?? this.automationRuntime.findByName(automationId);
        if (!automation) {
            throw new Error(`Automation not found: ${automationId}`);
        }

        return this.run({
            goal: goal ?? `Run automation ${automation.name}`,
            workflowSelectors: automation.workflowSelectors,
            hookSelectors: automation.hookSelectors,
            skillNames: automation.skillSelectors,
            connectorBindings: automation.connectors,
            workers: 2,
            executionMode: 'manual-low-level',
            manualOverrides: ['automation-runtime-entrypoint'],
        });
    }

    auditMemory(limit: number = 80): ReturnType<MemoryEngine['audit']> | undefined {
        return this.memoryEngine?.audit(limit);
    }

    listMemoryQuarantine(limit: number = 40): ReturnType<MemoryEngine['listQuarantined']> {
        return this.memoryEngine?.listQuarantined(limit) ?? [];
    }

    getNetworkStatus(): unknown {
        const snapshot = this.federation.getSnapshot();
        this.recordFederationUsage(snapshot.activePeerLinks, snapshot.knownPeers.length, snapshot.tracesPublished, snapshot.relay);
        return snapshot;
    }

    previewGovernancePreflight(input: {
        goal: string;
        files: string[];
        tokenCount: number;
        isDestructive?: boolean;
    }): ReturnType<GuardrailEngine['check']> {
        return this.guardrails.check({
            action: `execute: ${input.goal}`,
            filesToModify: input.files,
            tokenCount: input.tokenCount,
            isDestructive: Boolean(input.isDestructive),
        });
    }

    async storeMemoryAndDispatch(content: string, priority: number = 0.7, tags: string[] = [], parentId?: string, depth?: number): Promise<{
        id: string;
        hookEvents: Array<Record<string, unknown>>;
        automationDispatches: Awaited<ReturnType<AutomationRuntime['dispatch']>>;
        continuationRuns: ExecutionRun[];
    }> {
        const id = this.memoryEngine
            ? this.memoryEngine.store(content, priority, tags, parentId, depth)
            : String(this.defaultMemoryBackend.store(content, priority, tags, parentId, depth));
        const dispatched = await this.dispatchStoredMemory(id, content, priority, tags);
        return { id, ...dispatched };
    }

    async dispatchStoredMemory(id: string, content: string, priority: number = 0.7, tags: string[] = []): Promise<{
        hookEvents: Array<Record<string, unknown>>;
        automationDispatches: Awaited<ReturnType<AutomationRuntime['dispatch']>>;
        continuationRuns: ExecutionRun[];
    }> {
        nexusEventBus.emit('memory.store', { id, priority, tags, tier: priority > 0.8 ? 'cortex' : 'hippocampus' });
        this.markUsage('memories', {
            summary: `Stored memory with priority ${priority.toFixed(2)}`,
            count: tags.length,
            details: tags,
        });

        const hooks = this.hookRuntime.dispatch('memory.stored', this.listHooks(), {
            goal: content,
            allowMutateHooks: false,
            tags,
        });
        hooks.events.forEach((event) => {
            nexusEventBus.emit('hook.fire', {
                hookId: String(event.hookId),
                name: String(event.name),
                trigger: String(event.trigger),
                blocked: event.type === 'hook.blocked',
            });
        });
        if (hooks.skillSelectors.length > 0) {
            this.markUsage('hooks', {
                summary: `memory.stored hook queued ${hooks.skillSelectors.length} skill selector(s)`,
                count: hooks.skillSelectors.length,
                details: hooks.skillSelectors,
            });
        }

        const automations = await this.automationRuntime.dispatch('memory.stored', this.listAutomations(), {
            goal: content,
            executeConnectors: true,
            payload: { memoryId: id, priority, tags },
        });
        automations.forEach((dispatch) => {
            nexusEventBus.emit('automation.run', {
                automationId: dispatch.automationId,
                trigger: dispatch.trigger,
                queued: Boolean(dispatch.queuedRun),
            });
        });
        if (automations.length > 0) {
            this.markUsage('automations', {
                summary: `${automations.length} automation(s) dispatched after memory store`,
                count: automations.length,
                details: automations.map((dispatch) => dispatch.name),
            });
        }

        const continuationRuns = await this.executeAutomationContinuations({
            ...({
                runId: `memory-${id}`,
                goal: content,
                state: 'merged',
                mode: 'real',
                continuationChildren: [],
            } as ExecutionRun),
            plannerState: undefined,
            plannerResult: undefined,
            workerManifests: [],
            activeSkills: [],
            activeWorkflows: [],
            activeHooks: [],
            activeAutomations: [],
            selectedBackends: {
                memoryBackend: this.defaultMemoryBackend.descriptor.kind,
                compressionBackend: this.defaultCompressionBackend?.descriptor.kind ?? 'deterministic-token-supremacy',
                consensusPolicy: 'multi-tier-byzantine',
                dslCompiler: this.defaultDslCompiler?.descriptor.kind ?? 'deterministic-nxl-compiler',
            },
            workerResults: [],
            verificationResults: [],
            skillEvents: [],
            workflowEvents: [],
            hookEvents: hooks.events,
            automationEvents: automations.map((dispatch) => ({ type: 'automation.dispatched', ...dispatch })),
            backendEvidence: { notes: [], memory: {}, compression: {}, consensus: {}, dsl: {}, fallbacks: [] },
            promotionDecisions: [],
            shieldDecisions: [],
            memoryChecks: [],
            federationState: this.federation.getSnapshot(),
            artifactsPath: this.resolveArtifactsRoot(),
            artifactsIndex: {},
            result: content,
        }, automations, {
            continuationDepth: 0,
            sourceAutomationId: undefined,
        });

        return { hookEvents: hooks.events, automationDispatches: automations, continuationRuns };
    }

    async runWorkflow(workflowId: string, goal?: string): Promise<ExecutionRun> {
        const workflow = this.workflowRuntime.getArtifact(workflowId) ?? this.workflowRuntime.findByName(workflowId);
        if (!workflow) {
            throw new Error(`Workflow not found: ${workflowId}`);
        }

        return this.run({
            goal: goal ?? `Run workflow ${workflow.name}`,
            workflowSelectors: [workflow.name],
            workers: 2,
            executionMode: 'manual-low-level',
            manualOverrides: ['workflow-runtime-entrypoint'],
        });
    }

    getBackendCatalog(): Record<string, unknown> {
        return {
            memory: [...this.backendRegistry.memory.values()].map((backend) => backend.descriptor),
            compression: [...this.backendRegistry.compression.values()].map((backend) => backend.descriptor),
            dsl: [...this.backendRegistry.dsl.values()].map((backend) => backend.descriptor),
            consensus: [{ kind: 'multi-tier-byzantine', mode: 'default' }],
            crews: listCrewTemplates().map((crew) => ({ crewId: crew.crewId, name: crew.name, domains: crew.domains })),
            specialists: listSpecialists().slice(0, 24).map((specialist) => ({
                specialistId: specialist.specialistId,
                name: specialist.name,
                division: specialist.division,
                authority: specialist.authority,
            })),
            hooks: this.hookRuntime.listArtifacts().map((hook) => ({ hookId: hook.hookId, name: hook.name, trigger: hook.trigger })),
            automations: this.automationRuntime.listArtifacts().map((automation) => ({ automationId: automation.automationId, name: automation.name, triggerMode: automation.triggerMode })),
        };
    }

    getHealth(): Record<string, unknown> {
        return {
            runtime: 'healthy',
            runtimeId: this.runtimeId,
            runsTracked: this.runs.size,
            skills: this.skillRuntime.listArtifacts().length,
            workflows: this.workflowRuntime.listArtifacts().length,
            hooks: this.hookRuntime.listArtifacts().length,
            automations: this.automationRuntime.listArtifacts().length,
            specialists: listSpecialists().length,
            crews: listCrewTemplates().length,
            plannerOverlay: process.env.NEXUS_SPECIALIST_PLANNER_DISABLED === '1' ? 'disabled' : 'enabled',
            shield: 'balanced',
            federation: this.federation.getSnapshot(),
            usage: this.runtimeSnapshot.usage,
            tokens: this.runtimeSnapshot.tokens ?? createEmptyTokenSummary(),
            orchestration: this.runtimeSnapshot.orchestration,
            clients: this.runtimeSnapshot.clients,
            artifactsRoot: this.resolveArtifactsRoot(),
        };
    }

    private resolveArtifactsRoot(): string {
        return this.artifactsRoot ?? path.join(os.tmpdir(), 'nexus-prime-runs');
    }

    private loadPersistedRuns(limit: number): ExecutionRun[] {
        const root = this.resolveArtifactsRoot();
        if (!fs.existsSync(root)) {
            return [];
        }

        try {
            return fs.readdirSync(root, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => path.join(root, entry.name, 'run.json'))
                .filter((runPath) => fs.existsSync(runPath))
                .map((runPath) => {
                    try {
                        return JSON.parse(fs.readFileSync(runPath, 'utf8')) as ExecutionRun;
                    } catch {
                        return undefined;
                    }
                })
                .filter((run): run is ExecutionRun => Boolean(run))
                .sort((a, b) => extractRunTimestamp(b) - extractRunTimestamp(a))
                .slice(0, Math.max(limit, 1));
        } catch {
            return [];
        }
    }

    private async normalizeTask(input: Partial<ExecutionTask> & { goal: string }): Promise<ExecutionTask> {
        const task: ExecutionTask = {
            goal: input.goal,
            files: input.files ?? [],
            workers: Math.max(2, Math.min(input.workers ?? 2, 7)),
            roles: input.roles ?? ['planner', 'coder', 'verifier', 'skill-maker', 'research-shadow'],
            strategies: input.strategies ?? ['minimal', 'standard', 'thorough'],
            verifyCommands: input.verifyCommands ?? this.defaultVerifyCommands(),
            successCriteria: input.successCriteria ?? ['Verified diff applied successfully'],
            rollbackPolicy: 'patch-revert',
            timeoutMs: input.timeoutMs ?? 120000,
            skillPolicy: input.skillPolicy ?? { mode: 'guarded-hot', allowMutateSkills: false },
            backendSelectors: input.backendSelectors ?? {},
            skillNames: input.skillNames ?? [],
            workflowSelectors: input.workflowSelectors ?? [],
            hookSelectors: input.hookSelectors ?? [],
            automationSelectors: input.automationSelectors ?? [],
            connectorBindings: input.connectorBindings ?? [],
            actions: input.actions ?? [],
            inlineSkills: input.inlineSkills ?? [],
            nxlScript: input.nxlScript,
            promotionPolicy: input.promotionPolicy ?? {
                autoPromoteSkills: true,
                autoPromoteWorkflows: true,
                globalThreshold: 1,
            },
            derivationPolicy: input.derivationPolicy ?? { mode: 'auto' },
            checkpointPolicy: input.checkpointPolicy ?? ['before-read', 'before-mutate', 'before-verify', 'retry'],
            backendMode: input.backendMode ?? 'default',
            shieldPolicy: input.shieldPolicy ?? 'balanced',
            memoryPolicy: input.memoryPolicy ?? { mode: 'balanced', quarantineTag: '#quarantine' },
            crewSelectors: input.crewSelectors ?? [],
            specialistSelectors: input.specialistSelectors ?? [],
            optimizationProfile: input.optimizationProfile ?? 'standard',
            reviewPolicy: input.reviewPolicy ?? { mode: 'full' },
            releasePolicy: input.releasePolicy ?? { mode: 'ship-ready' },
            continuationPolicy: input.continuationPolicy ?? { mode: 'suggest' },
            parentRunId: input.parentRunId,
            sourceAutomationId: input.sourceAutomationId,
            continuationDepth: Math.max(0, Number(input.continuationDepth ?? 0)),
            suppressedAutomationIds: dedupeStrings(input.suppressedAutomationIds ?? []),
            allowedToolsOverride: input.allowedToolsOverride,
            executionMode: input.executionMode ?? 'manual-low-level',
            manualOverrides: dedupeStrings(input.manualOverrides ?? []),
            instructionPacket: input.instructionPacket,
            executionLedger: input.executionLedger,
            knowledgeFabric: input.knowledgeFabric,
        };

        if (input.nxlScript && (!input.actions || input.actions.length === 0)) {
            const compiled = (this.defaultDslCompiler ?? this.backendRegistry.dsl.get('deterministic-nxl-compiler')!).compile(task.goal, input.nxlScript);
            const compiledTask = this.executionTaskFromCompiled(compiled, input.nxlScript);
            return {
                ...task,
                ...compiledTask,
                nxlScript: input.nxlScript,
            };
        }

        return task;
    }

    private executionTaskFromCompiled(compiled: DSLCompilationResult, rawScript?: string): Partial<ExecutionTask> & { goal: string } {
        const compiledSpec = compiled.spec as unknown as Record<string, unknown>;
        const compiledMemoryPolicy = (compiledSpec.memoryPolicy as MemoryPolicy | undefined);
        return {
            goal: compiled.spec.goal,
            files: compiled.spec.files,
            workers: compiled.spec.workers,
            roles: compiled.spec.roles,
            strategies: compiled.spec.strategies,
            verifyCommands: compiled.spec.verify,
            successCriteria: ['NXL execution graph completed with verified diff'],
            rollbackPolicy: 'patch-revert',
            timeoutMs: 120000,
            skillPolicy: {
                mode: compiled.spec.skillPolicy,
                allowMutateSkills: false,
            },
            backendSelectors: {
                memoryBackend: compiled.spec.memoryBackend,
                compressionBackend: compiled.spec.compressionBackend,
                consensusPolicy: compiled.spec.consensus,
                dslCompiler: compiled.spec.dslCompiler ?? 'deterministic-nxl-compiler',
            },
            skillNames: compiled.spec.skills,
            workflowSelectors: compiled.spec.workflows ?? [],
            hookSelectors: (compiledSpec.hooks as string[] | undefined) ?? [],
            automationSelectors: (compiledSpec.automations as string[] | undefined) ?? [],
            connectorBindings: (compiledSpec.connectors as ConnectorBinding[] | undefined) ?? [],
            actions: (compiled.spec.actions ?? []) as unknown as SkillBinding[],
            inlineSkills: [],
            nxlScript: rawScript,
            derivationPolicy: { mode: compiled.spec.derivationPolicy ?? 'auto' },
            backendMode: compiled.spec.backendMode ?? 'default',
            shieldPolicy: compiledSpec.shield as ShieldPolicyMode | undefined,
            memoryPolicy: {
                mode: compiledMemoryPolicy?.mode ?? 'balanced',
                quarantineTag: compiledMemoryPolicy?.quarantineTag ?? '#quarantine',
            },
            crewSelectors: (compiledSpec.crews as string[] | undefined) ?? [],
            specialistSelectors: (compiledSpec.specialists as string[] | undefined) ?? [],
            optimizationProfile: (compiledSpec.optimizationProfile as OptimizationProfile | undefined) ?? 'standard',
            reviewPolicy: { mode: (compiledSpec.reviewPolicy as ReviewPolicy | undefined)?.mode ?? 'full' },
            releasePolicy: { mode: (compiledSpec.releasePolicy as ReleasePolicy | undefined)?.mode ?? 'ship-ready' },
            continuationPolicy: { mode: (compiledSpec.continuationPolicy as ContinuationPolicy | undefined)?.mode ?? 'suggest' },
        };
    }

    private resolveBackends(task: ExecutionTask): {
        memory: ReturnType<typeof resolveBackend<MemoryBackend>>;
        compression: ReturnType<typeof resolveBackend<CompressionBackend>>;
        dsl: ReturnType<typeof resolveBackend<DSLCompilerBackend>>;
        fallbacks: string[];
    } {
        const memory = resolveBackend(this.backendRegistry.memory, task.backendSelectors.memoryBackend, this.defaultMemoryBackend.descriptor.kind);
        const compression = resolveBackend(this.backendRegistry.compression, task.backendSelectors.compressionBackend, this.defaultCompressionBackend?.descriptor.kind ?? 'deterministic-token-supremacy');
        const dsl = resolveBackend(this.backendRegistry.dsl, task.backendSelectors.dslCompiler, this.defaultDslCompiler?.descriptor.kind ?? 'deterministic-nxl-compiler');
        const fallbacks = [memory.fallback, compression.fallback, dsl.fallback].filter(Boolean) as string[];
        return { memory, compression, dsl, fallbacks };
    }

    private defaultVerifyCommands(): string[] {
        return fs.existsSync(path.join(this.repoRoot, 'package.json'))
            ? ['npm run build']
            : [];
    }

    private createWorkerManifests(
        task: ExecutionTask,
        files: FileRef[],
        plan: ReadingPlan,
        activeSkills: SkillArtifact[],
        activeWorkflows: WorkflowArtifact[],
        actions: SkillBinding[],
        verifyCommands: string[],
        plannerState?: TaskPlannerState
    ): WorkerManifest[] {
        const workerIds = new Array(task.workers).fill(null).map((_, idx) => `coder-${idx + 1}`);
        const budgets = this.resolveCompressionBackend(task).allocateWorkerBudget(workerIds, plan);
        const sessionSkillIds = activeSkills.map(skill => skill.skillId);
        const workflowIds = activeWorkflows.map((workflow) => workflow.workflowId);
        const fallbackTools = task.allowedToolsOverride && task.allowedToolsOverride.length > 0
            ? task.allowedToolsOverride
            : undefined;
        const selectedSpecialists = plannerState?.selectedSpecialists ?? [];
        const mutateSpecialists = selectedSpecialists.filter((specialist) => specialist.authority === 'mutate');
        const reviewSpecialists = selectedSpecialists.filter((specialist) => specialist.authority !== 'mutate');
        const plannerSpecialist = selectedSpecialists[0];
        const skillMakerSpecialist = reviewSpecialists[0] ?? selectedSpecialists[1] ?? plannerSpecialist;
        const researchSpecialist = selectedSpecialists[selectedSpecialists.length - 1] ?? plannerSpecialist;

        const manifests: WorkerManifest[] = [
            {
                workerId: 'planner-1',
                role: 'planner',
                strategy: 'plan',
                worktreeDir: null,
                specialistId: plannerSpecialist?.specialistId,
                specialistName: plannerSpecialist?.name,
                files,
                skillOverlays: { base: task.skillNames, session: sessionSkillIds, worker: [], runtimeHot: sessionSkillIds },
                workflowOverlays: workflowIds,
                allowedTools: scopedTools(fallbackTools, ['read_file', 'run_command']),
                tokenBudget: Math.max(200, Math.round(plan.totalEstimatedTokens * 0.3)),
                verifyCommands,
                checkpoints: task.checkpointPolicy,
                actions: [],
                inlineSkills: activeSkills,
                workflows: activeWorkflows,
                context: {} as WorkerContextPacket,
            },
            {
                workerId: 'skill-maker-1',
                role: 'skill-maker',
                strategy: 'derive',
                worktreeDir: null,
                specialistId: skillMakerSpecialist?.specialistId,
                specialistName: skillMakerSpecialist?.name,
                files,
                skillOverlays: { base: task.skillNames, session: sessionSkillIds, worker: [], runtimeHot: sessionSkillIds },
                workflowOverlays: workflowIds,
                allowedTools: scopedTools(fallbackTools, ['read_file', 'write_file', 'append_file', 'replace_text']),
                tokenBudget: 240,
                verifyCommands,
                checkpoints: task.checkpointPolicy,
                actions: [],
                inlineSkills: activeSkills,
                workflows: activeWorkflows,
                context: {} as WorkerContextPacket,
            },
            {
                workerId: 'research-shadow-1',
                role: 'research-shadow',
                strategy: task.backendMode,
                worktreeDir: null,
                specialistId: researchSpecialist?.specialistId,
                specialistName: researchSpecialist?.name,
                files,
                skillOverlays: { base: task.skillNames, session: sessionSkillIds, worker: [], runtimeHot: sessionSkillIds },
                workflowOverlays: workflowIds,
                allowedTools: scopedTools(fallbackTools, ['read_file', 'run_command']),
                tokenBudget: 240,
                verifyCommands,
                checkpoints: task.checkpointPolicy,
                actions: [],
                inlineSkills: activeSkills,
                workflows: activeWorkflows,
                context: {} as WorkerContextPacket,
            },
        ];

        workerIds.forEach((workerId, idx) => {
            const coderSpecialist = mutateSpecialists[idx % Math.max(mutateSpecialists.length, 1)]
                ?? selectedSpecialists[idx % Math.max(selectedSpecialists.length, 1)];
            const verifierSpecialist = reviewSpecialists[idx % Math.max(reviewSpecialists.length, 1)]
                ?? selectedSpecialists[idx % Math.max(selectedSpecialists.length, 1)];
            manifests.push({
                workerId,
                role: 'coder',
                strategy: task.strategies[idx % task.strategies.length],
                worktreeDir: null,
                specialistId: coderSpecialist?.specialistId,
                specialistName: coderSpecialist?.name,
                files,
                skillOverlays: {
                    base: task.skillNames,
                    session: sessionSkillIds,
                    worker: [],
                    runtimeHot: sessionSkillIds,
                },
                workflowOverlays: workflowIds,
                allowedTools: scopedTools(fallbackTools, ['write_file', 'append_file', 'replace_text', 'run_command']),
                tokenBudget: budgets.get(workerId) ?? 500,
                verifyCommands,
                checkpoints: task.checkpointPolicy,
                actions,
                inlineSkills: activeSkills,
                workflows: activeWorkflows,
                context: {} as WorkerContextPacket,
            });
            manifests.push({
                workerId: `verifier-${idx + 1}`,
                role: 'verifier',
                strategy: `verify-${task.strategies[idx % task.strategies.length]}`,
                worktreeDir: null,
                specialistId: verifierSpecialist?.specialistId,
                specialistName: verifierSpecialist?.name,
                files,
                skillOverlays: {
                    base: task.skillNames,
                    session: sessionSkillIds,
                    worker: [],
                    runtimeHot: sessionSkillIds,
                },
                workflowOverlays: workflowIds,
                allowedTools: scopedTools(fallbackTools, ['run_command']),
                tokenBudget: Math.max(200, Math.round((budgets.get(workerId) ?? 500) * 0.4)),
                verifyCommands,
                checkpoints: task.checkpointPolicy,
                actions: [],
                inlineSkills: activeSkills,
                workflows: activeWorkflows,
                context: {} as WorkerContextPacket,
                targetWorkerId: workerId,
            });
        });

        manifests.forEach((manifest) => {
            manifest.context = this.buildWorkerContext('pending-run', task, manifest, activeSkills, activeWorkflows, plannerState);
        });

        return manifests;
    }

    private createPlannerResult(
        task: ExecutionTask,
        manifests: WorkerManifest[],
        files: FileRef[],
        domains: string[],
        plannerState?: TaskPlannerState
    ): PlannerResult {
        return {
            summary: `Planner assigned ${manifests.filter((manifest) => manifest.role === 'coder').length} coder worker(s) and ${manifests.filter((manifest) => manifest.role === 'verifier').length} verifier worker(s)${plannerState?.selectedCrew ? ` under ${plannerState.selectedCrew.name}` : ''}.`,
            domains,
            selectedFiles: files.map((file) => path.relative(this.repoRoot, file.path) || file.path),
            selectedWorkflows: task.workflowSelectors,
            selectedSkills: task.skillNames,
            selectedTools: task.allowedToolsOverride ?? ['read_file', 'run_command'],
            selectedCrew: plannerState?.selectedCrew,
            selectedSpecialists: plannerState?.selectedSpecialists ?? [],
            fallbackPlan: plannerState?.fallbackPlan,
            reviewGates: plannerState?.reviewGates ?? [],
            continuation: plannerState?.continuation,
            ledger: plannerState?.ledger ?? [],
            strategyMap: manifests
                .filter((manifest) => manifest.role === 'coder')
                .map((manifest) => ({ workerId: manifest.workerId, strategy: manifest.strategy })),
            risks: [
                task.verifyCommands.length === 0 ? 'No verification commands configured.' : 'Verification required before merge.',
                task.skillPolicy.allowMutateSkills ? 'Mutate skills enabled.' : 'Mutate skills remain gated.',
                plannerState?.fallbackPlan?.summary ?? 'Fallback remains current runtime domain-pack execution.',
            ],
        };
    }

    private async runCoderWorker(runId: string, recorder: ArtifactRecorder, manifest: WorkerManifest): Promise<RuntimeWorkerResult> {
        const session = new WorktreeSession(this.repoRoot, `${runId}-${manifest.workerId}`, 'coder', recorder);
        const start = Date.now();
        const learnings: string[] = [];
        const workerDir = recorder.workerDir(manifest.workerId);

        try {
            nexusEventBus.emit('phantom.worker.start', {
                workerId: manifest.workerId,
                approach: manifest.strategy,
                goal: manifest.files.map((file) => file.path).join(', '),
            });

            await session.create();
            manifest.worktreeDir = session.worktreeDir;
            this.writeWorktreeContext(session.worktreeDir, manifest.context);
            this.writeWorktreePacket(session.worktreeDir, this.runs.get(runId)?.instructionPacket);
            manifest.files.forEach(file => this.sessionDNA?.recordFileAccess(file.path));

            const readSkills = manifest.inlineSkills.filter(skill => skill.riskClass === 'read');
            for (const skill of readSkills) {
                this.sessionDNA?.recordSkill(skill.name);
                this.skillRuntime.deploy(skill, manifest.workerId, session.worktreeDir, 'before-read');
                learnings.push(`Activated read skill: ${skill.name}`);
            }

            const mutatePhaseSkills = manifest.inlineSkills.filter(skill => skill.riskClass !== 'read');
            for (const skill of mutatePhaseSkills) {
                this.sessionDNA?.recordSkill(skill.name);
                this.skillRuntime.deploy(skill, manifest.workerId, session.worktreeDir, 'before-mutate');
                learnings.push(`Activated mutate-phase skill: ${skill.name}`);
            }

            const allowedActions = filterBindingsByTools(manifest.actions, manifest.allowedTools);
            const blockedActions = manifest.actions.length - allowedActions.length;
            if (blockedActions > 0) {
                learnings.push(`Skipped ${blockedActions} binding(s) blocked by the worker tool policy.`);
            }
            if (allowedActions.length > 0) {
                learnings.push(`Applied ${allowedActions.length} runtime binding(s): ${allowedActions.map((binding) => binding.type).join(', ')}`);
            }

            const modifiedFiles = await session.applyBindings(allowedActions);
            modifiedFiles.forEach(file => {
                this.sessionDNA?.recordFileModified(file);
                learnings.push(`Modified ${file}`);
            });

            const diff = await session.captureDiff();
            recorder.writeText(path.join('workers', manifest.workerId, 'diff.patch'), diff);
            podNetwork.publish(manifest.workerId, `Produced ${modifiedFiles.length} modified files`, 0.8, ['#runtime-worker']);
            nexusEventBus.emit('phantom.worker.complete', { workerId: manifest.workerId, confidence: diff.trim() ? 0.7 : 0.2 });

            return {
                workerId: manifest.workerId,
                role: manifest.role,
                taskId: runId,
                approach: manifest.strategy,
                diff,
                outcome: diff.trim() ? 'partial' : 'failed',
                confidence: diff.trim() ? 0.68 : 0.18,
                tokensUsed: Math.max(1, Math.round((Date.now() - start) / 100)),
                learnings,
                testsPassing: 0,
                verified: false,
                artifactsPath: workerDir,
                modifiedFiles,
            };
        } catch (error: any) {
            return {
                workerId: manifest.workerId,
                role: manifest.role,
                taskId: runId,
                approach: manifest.strategy,
                diff: '',
                outcome: 'failed',
                confidence: 0,
                tokensUsed: 0,
                learnings: [`Worker failed: ${String(error?.message ?? error)}`],
                verified: false,
                artifactsPath: workerDir,
                modifiedFiles: [],
            };
        } finally {
            await session.cleanup();
        }
    }

    private async runVerifierWorker(
        runId: string,
        recorder: ArtifactRecorder,
        manifest: WorkerManifest,
        target?: RuntimeWorkerResult
    ): Promise<WorkerVerification> {
        const verifier = new WorktreeSession(this.repoRoot, `${runId}-${manifest.workerId}`, 'verifier', recorder);
        const records: CommandRecord[] = [];
        const artifactsPath = recorder.workerDir(manifest.workerId);

        try {
            await verifier.create();
            this.writeWorktreeContext(verifier.worktreeDir, manifest.context);
            this.writeWorktreePacket(verifier.worktreeDir, this.runs.get(runId)?.instructionPacket);
            if (!target?.diff?.trim()) {
                return {
                    workerId: manifest.targetWorkerId ?? 'unknown',
                    verifierId: manifest.workerId,
                    passed: false,
                    commands: [],
                    summary: 'Verifier skipped because candidate diff was empty.',
                    artifactsPath,
                };
            }

            const verifySkills = manifest.inlineSkills.filter(skill => skill.riskClass !== 'mutate');
            for (const skill of verifySkills) {
                this.skillRuntime.deploy(skill, manifest.workerId, verifier.worktreeDir, 'before-verify');
            }

            await verifier.applyPatchContent(target.diff);

            for (const command of manifest.verifyCommands) {
                const record = await verifier.run(command, true);
                records.push(record);
            }

            const passed = records.length > 0 ? records.every((record) => record.exitCode === 0) : !!target.diff.trim();
            const metrics: SkillRuntimeMetrics = {
                success: passed,
                verificationPassed: passed,
                retriesAvoided: passed ? 1 : 0,
            };
            manifest.inlineSkills
                .filter(skill => skill.riskClass !== 'mutate')
                .forEach(skill => {
                    this.skillRuntime.recordOutcome(skill.skillId, metrics);
                });
            manifest.workflows.forEach((workflow) => {
                this.workflowRuntime.recordOutcome(workflow.workflowId, { success: passed, verificationPassed: passed, retriesAvoided: passed ? 1 : 0 });
            });

            return {
                workerId: manifest.targetWorkerId ?? 'unknown',
                verifierId: manifest.workerId,
                passed,
                commands: records,
                summary: passed
                    ? `Verifier passed ${records.length} command(s).`
                    : `Verifier failed ${records.filter(record => record.exitCode !== 0).length} command(s).`,
                artifactsPath,
            };
        } finally {
            await verifier.cleanup();
        }
    }

    private async applyDecision(
        recorder: ArtifactRecorder,
        task: ExecutionTask,
        decision: MergeDecision,
        consensusPolicy: MultiTierConsensusPolicy
    ): Promise<{ applied: boolean; rolledBack: boolean; summary: string }> {
        const candidateDiff = this.resolveCandidateDiff(decision);
        if (!candidateDiff.trim()) {
            return {
                applied: false,
                rolledBack: false,
                summary: `Execution finished with ${decision.action} but no applicable diff was produced.`,
            };
        }

        if (!consensusPolicy.approveRunLevelChange(
            decision.winner ? [decision.winner.workerId] : ['merge-oracle']
        )) {
            return {
                applied: false,
                rolledBack: false,
                summary: 'Run-level consensus rejected the final patch.',
            };
        }

        const patchPath = recorder.writeText('final.patch', candidateDiff);
        try {
            await exec(`git apply --whitespace=nowarn ${quote(patchPath)}`, {
                cwd: this.repoRoot,
                maxBuffer: 1024 * 1024 * 20,
            });

            const verifyRecords: CommandRecord[] = [];
            for (const command of task.verifyCommands) {
                const record = await runCommand(this.repoRoot, command, true);
                verifyRecords.push(record);
            }
            recorder.writeJson('final-verify.json', verifyRecords);

            const passed = verifyRecords.every(record => record.exitCode === 0);
            if (!passed) {
                await exec(`git apply -R --whitespace=nowarn ${quote(patchPath)}`, {
                    cwd: this.repoRoot,
                    maxBuffer: 1024 * 1024 * 20,
                });
                return {
                    applied: true,
                    rolledBack: true,
                    summary: 'Final patch applied but verification failed, so it was rolled back.',
                };
            }

            return {
                applied: true,
                rolledBack: false,
                summary: `Applied ${decision.action} patch successfully with ${verifyRecords.length} verification command(s).`,
            };
        } catch (error: any) {
            return {
                applied: false,
                rolledBack: false,
                summary: `Failed to apply final patch: ${String(error?.message ?? error)}`,
            };
        }
    }

    private evaluatePromotions(run: ExecutionRun, consensusPolicy: MultiTierConsensusPolicy): PromotionDecision[] {
        const verifiedWorkerIds = run.workerResults.filter((result) => result.verified).map((result) => result.workerId);
        const decisions: PromotionDecision[] = [];
        const reviewGateBlocked = (run.plannerState?.reviewGates ?? []).some((gate) => gate.status !== 'ready');

        if (reviewGateBlocked) {
            decisions.push({
                kind: 'backend',
                target: 'review-gates',
                scope: 'backend',
                approved: false,
                rationale: 'Promotion blocked because one or more runtime review gates remain pending or blocked.',
            });
            return decisions;
        }

        if (run.state === 'merged' && verifiedWorkerIds.length > 0) {
            if (run.activeSkills.length > 0) {
                for (const skill of run.activeSkills.filter((artifact) => artifact.scope !== 'base')) {
                    const shield = this.securityShield.evaluate({
                        stage: 'promotion',
                        target: `skill:${skill.name}`,
                        policy: 'balanced',
                        domains: skill.domain ? [skill.domain] : [],
                        riskClass: skill.riskClass,
                        verified: verifiedWorkerIds.length > 0,
                        bindings: skill.toolBindings,
                        text: skill.instructions,
                    });
                    run.shieldDecisions.push(shield);
                    if (shield.blocked || shield.action === 'quarantine') {
                        decisions.push({
                            kind: 'skill',
                            target: skill.name,
                            scope: 'session',
                            approved: false,
                            rationale: shield.summary,
                        });
                        continue;
                    }

                    const approved = consensusPolicy.approveGlobalPromotion(verifiedWorkerIds, [1, 1, 1]);
                    if (approved && run.selectedBackends.consensusPolicy === 'multi-tier-byzantine') {
                        this.skillRuntime.promote(skill.skillId, skill.riskClass === 'mutate' ? 'session' : 'global');
                    }
                    decisions.push({
                        kind: 'skill',
                        target: skill.name,
                        scope: approved ? (skill.riskClass === 'mutate' ? 'session' : 'global') : 'session',
                        approved,
                        rationale: approved ? 'Global promotion passed consensus.' : 'Global promotion stayed session-scoped.',
                    });
                }
            }

            if (run.activeWorkflows.length > 0) {
                for (const workflow of run.activeWorkflows.filter((artifact) => artifact.scope !== 'base')) {
                    const shield = this.securityShield.evaluate({
                        stage: 'promotion',
                        target: `workflow:${workflow.name}`,
                        policy: 'balanced',
                        domains: workflow.domain ? [workflow.domain] : [],
                        verified: verifiedWorkerIds.length > 0,
                        text: [workflow.description, ...workflow.guardrails, ...workflow.expectedOutputs],
                    });
                    run.shieldDecisions.push(shield);
                    if (shield.blocked || shield.action === 'quarantine') {
                        decisions.push({
                            kind: 'workflow',
                            target: workflow.name,
                            scope: 'session',
                            approved: false,
                            rationale: shield.summary,
                        });
                        continue;
                    }

                    const approved = consensusPolicy.approveGlobalPromotion(verifiedWorkerIds, [1, 1, 1]);
                    if (approved) {
                        this.workflowRuntime.deploy(workflow.workflowId, run.runId, 'global');
                    }
                    decisions.push({
                        kind: 'workflow',
                        target: workflow.name,
                        scope: approved ? 'global' : 'session',
                        approved,
                        rationale: approved ? 'Workflow promotion passed consensus.' : 'Workflow stayed session-scoped.',
                    });
                }
            }

            for (const hook of run.activeHooks.filter((artifact) => artifact.scope !== 'base')) {
                const shield = this.securityShield.evaluate({
                    stage: 'promotion',
                    target: `hook:${hook.name}`,
                    policy: 'balanced',
                    domains: hook.domain ? [hook.domain] : [],
                    riskClass: hook.riskClass,
                    verified: verifiedWorkerIds.length > 0,
                    bindings: hook.toolBindings,
                    text: [hook.description, ...hook.guardrails],
                });
                run.shieldDecisions.push(shield);
                const approved = !shield.blocked && shield.action !== 'quarantine' && consensusPolicy.approveGlobalPromotion(verifiedWorkerIds, [1, 1, 1]);
                if (approved) {
                    this.hookRuntime.deploy(hook.hookId, hook.riskClass === 'mutate' ? 'session' : 'global');
                }
                decisions.push({
                    kind: 'hook',
                    target: hook.name,
                    scope: approved ? (hook.riskClass === 'mutate' ? 'session' : 'global') : 'session',
                    approved,
                    rationale: approved ? 'Hook promotion passed shield and consensus.' : shield.summary,
                });
            }

            for (const automation of run.activeAutomations.filter((artifact) => artifact.scope !== 'base')) {
                const shield = this.securityShield.evaluate({
                    stage: 'promotion',
                    target: `automation:${automation.name}`,
                    policy: 'balanced',
                    domains: automation.domain ? [automation.domain] : [],
                    verified: verifiedWorkerIds.length > 0,
                    connectors: automation.connectors,
                    text: automation.description,
                });
                run.shieldDecisions.push(shield);
                const approved = !shield.blocked && shield.action !== 'quarantine' && consensusPolicy.approveGlobalPromotion(verifiedWorkerIds, [1, 1, 1]);
                if (approved) {
                    this.automationRuntime.deploy(automation.automationId, 'global');
                }
                decisions.push({
                    kind: 'automation',
                    target: automation.name,
                    scope: approved ? 'global' : 'session',
                    approved,
                    rationale: approved ? 'Automation promotion passed shield and consensus.' : shield.summary,
                });
            }
        }

        decisions.push({
            kind: 'backend',
            target: `${run.selectedBackends.memoryBackend}/${run.selectedBackends.compressionBackend}/${run.selectedBackends.dslCompiler}`,
            scope: 'backend',
            approved: true,
            rationale: 'Backend evidence recorded in the run ledger.',
        });

        return decisions;
    }

    private resolveCandidateDiff(decision: MergeDecision): string {
        const synthesized = decision.synthesized ?? '';
        if (looksLikePatch(synthesized)) {
            return synthesized;
        }
        return decision.winner?.diff ?? '';
    }

    private resolveFileRefs(files: string[]): FileRef[] {
        return files.map(file => {
            const resolved = path.isAbsolute(file) ? file : path.join(this.repoRoot, file);
            try {
                const stat = fs.statSync(resolved);
                return {
                    path: resolved,
                    sizeBytes: stat.size,
                    lastModified: stat.mtimeMs,
                };
            } catch {
                return {
                    path: resolved,
                    sizeBytes: 0,
                    lastModified: Date.now(),
                };
            }
        });
    }

    private discoverTargetFiles(goal: string, compressionBackend: CompressionBackend): FileRef[] {
        const files = scanFiles(this.repoRoot);
        const plan = normalizeReadingPlan(compressionBackend.planFiles(goal, files)).plan;
        return plan.files
            .filter(filePlan => filePlan.action !== 'skip')
            .slice(0, 8)
            .map(filePlan => filePlan.file);
    }

    private collectLibraryCounts() {
        return {
            skills: this.skillRuntime.listArtifacts().length,
            workflows: this.workflowRuntime.listArtifacts().length,
            hooks: this.hookRuntime.listArtifacts().length,
            automations: this.automationRuntime.listArtifacts().length,
            specialists: listSpecialists().length,
            crews: listCrewTemplates().length,
        };
    }

    private createManualLedger(task: ExecutionTask): ExecutionLedger {
        const primaryClient = this.runtimeSnapshot.clients?.primary;
        const ledger = createExecutionLedger({
            sessionId: this.runtimeSnapshot.orchestration?.sessionId ?? `runtime-${this.runtimeId}`,
            task: task.goal,
            executionMode: task.executionMode,
            clientId: primaryClient?.clientId,
            clientFamily: primaryClient?.clientFamily,
        });
        markExecutionLedgerStep(ledger, 'identify-client-session', 'completed', {
            summary: primaryClient?.displayName ?? 'Runtime-only execution',
            details: {
                clientId: primaryClient?.clientId ?? 'runtime',
                source: primaryClient?.source ?? 'runtime',
            },
        });
        markExecutionLedgerStep(ledger, 'recall-memory', 'skipped', {
            reason: 'manual-low-level',
            summary: 'Memory recall was bypassed by the caller.',
        });
        markExecutionLedgerStep(ledger, 'memory-stats', 'skipped', {
            reason: 'manual-low-level',
            summary: 'Memory stats were bypassed by the caller.',
        });
        markExecutionLedgerStep(ledger, 'catalog-shortlist', 'skipped', {
            reason: 'manual-low-level',
            summary: 'Catalog shortlist was not compiled outside the orchestrator.',
        });
        markExecutionLedgerStep(ledger, 'knowledge-fabric', 'skipped', {
            reason: 'manual-low-level',
            summary: 'Knowledge Fabric assembly was bypassed on this low-level path.',
        });
        markExecutionLedgerStep(ledger, 'compile-instruction-packet', 'skipped', {
            reason: 'manual-low-level',
            summary: 'Instruction packet compilation was bypassed.',
        });
        markExecutionLedgerStep(ledger, 'structured-learning', 'skipped', {
            reason: 'manual-low-level',
            summary: 'Structured learning was not requested for this low-level path.',
        });
        return ledger;
    }

    private syncExecutionMetadata(run: ExecutionRun): void {
        this.runs.set(run.runId, run);
        const shouldPromoteExecutionSnapshot = !run.parentRunId || Boolean(run.instructionPacket);
        if (shouldPromoteExecutionSnapshot) {
            this.recordInstructionPacket(run.instructionPacket, {
                executionMode: run.executionLedger?.executionMode ?? this.runtimeSnapshot.executionMode ?? 'manual-low-level',
                plannerApplied: run.executionLedger?.plannerApplied ?? this.runtimeSnapshot.plannerApplied ?? false,
                tokenOptimizationApplied: run.executionLedger?.tokenOptimizationApplied ?? this.runtimeSnapshot.tokenOptimizationApplied ?? false,
            });
            this.recordExecutionLedger(run.executionLedger, run.executionLedger?.executionMode);
            this.recordKnowledgeFabricSnapshot(run.knowledgeFabric ? toKnowledgeFabricSnapshot(run.knowledgeFabric) : this.runtimeSnapshot.knowledgeFabric);
        }

        const runtimeDir = path.join(run.artifactsPath, 'runtime');
        fs.mkdirSync(runtimeDir, { recursive: true });
        if (run.executionLedger) {
            fs.writeFileSync(path.join(runtimeDir, 'execution-ledger.json'), JSON.stringify(run.executionLedger, null, 2), 'utf8');
        }
        if (run.instructionPacket) {
            this.instructionGateway.persist(run.instructionPacket, this.repoRoot);
            fs.writeFileSync(path.join(runtimeDir, 'packet.json'), JSON.stringify(run.instructionPacket, null, 2), 'utf8');
            fs.writeFileSync(path.join(runtimeDir, 'packet.md'), renderInstructionPacketMarkdown(run.instructionPacket), 'utf8');
        }
        if (run.knowledgeFabric) {
            fs.writeFileSync(path.join(runtimeDir, 'knowledge-fabric.json'), JSON.stringify(run.knowledgeFabric, null, 2), 'utf8');
        }
    }

    private collectSkipReasons(ledger: ExecutionLedger | undefined, existing: string[] = []): string[] {
        const reasons = new Set(existing);
        for (const step of ledger?.steps ?? []) {
            if ((step.status === 'skipped' || step.status === 'blocked' || step.status === 'failed') && step.reason) {
                reasons.add(step.reason);
            }
        }
        return [...reasons];
    }

    private deriveSequenceCompliance(snapshot: RuntimeRegistrySnapshot): RuntimeSequenceComplianceSnapshot {
        const now = Date.now();
        const hasObservedActivity = Boolean(snapshot.executionLedger || (snapshot.lastToolCalls?.length ?? 0) > 0);
        if (hasObservedActivity && (snapshot.executionMode ?? 'manual-low-level') === 'manual-low-level' && (snapshot.orchestrateCalled ?? false) === false) {
            return {
                status: 'manual-low-level',
                summary: 'Manual low-level execution bypassed the bootstrap-to-orchestrate sequence.',
                updatedAt: now,
            };
        }
        if (snapshot.bootstrapCalled && snapshot.orchestrateCalled) {
            return {
                status: 'compliant',
                summary: 'Active client followed nexus_session_bootstrap before nexus_orchestrate.',
                updatedAt: now,
            };
        }
        if (snapshot.bootstrapCalled || snapshot.orchestrateCalled || snapshot.plannerCalled || (snapshot.lastToolCalls?.length ?? 0) > 0) {
            return {
                status: 'partial',
                summary: 'Client activity detected, but the full bootstrap-to-orchestrate path was not observed yet.',
                updatedAt: now,
            };
        }
        return {
            status: 'idle',
            summary: 'No client tool sequence recorded yet.',
            updatedAt: now,
        };
    }

    private persistRuntimeSnapshot(patch: Partial<RuntimeRegistrySnapshot>): RuntimeRegistrySnapshot {
        const executionLedger = patch.executionLedger ?? this.runtimeSnapshot?.executionLedger;
        const skipReasons = this.collectSkipReasons(executionLedger, patch.skipReasons ?? this.runtimeSnapshot?.skipReasons ?? []);
        const nextSnapshot: RuntimeRegistrySnapshot = {
            ...this.runtimeSnapshot,
            ...patch,
            runtimeId: patch.runtimeId ?? this.runtimeSnapshot?.runtimeId ?? this.runtimeId,
            pid: patch.pid ?? this.runtimeSnapshot?.pid ?? process.pid,
            cwd: patch.cwd ?? this.runtimeSnapshot?.cwd ?? this.repoRoot,
            entrypoint: patch.entrypoint ?? this.runtimeSnapshot?.entrypoint ?? 'sub-agent-runtime',
            startedAt: patch.startedAt ?? this.runtimeSnapshot?.startedAt ?? this.startedAt,
            lastHeartbeatAt: patch.lastHeartbeatAt ?? Date.now(),
            lastActivityAt: patch.lastActivityAt ?? Date.now(),
            libraries: patch.libraries ?? this.runtimeSnapshot?.libraries ?? this.collectLibraryCounts(),
            usage: {
                ...createEmptyUsageState(),
                ...(this.runtimeSnapshot?.usage ?? {}),
                ...(patch.usage ?? {}),
            },
            latestRun: patch.latestRun ?? this.runtimeSnapshot?.latestRun,
            federation: patch.federation ?? this.runtimeSnapshot?.federation,
            tokens: patch.tokens ?? this.runtimeSnapshot?.tokens ?? createEmptyTokenSummary(),
            orchestration: patch.orchestration ?? this.runtimeSnapshot?.orchestration,
            knowledgeFabric: patch.knowledgeFabric ?? this.runtimeSnapshot?.knowledgeFabric,
            clients: patch.clients ?? this.runtimeSnapshot?.clients,
            clientId: patch.clientId ?? this.runtimeSnapshot?.clientId,
            clientFamily: patch.clientFamily ?? this.runtimeSnapshot?.clientFamily,
            instructionPacketHash: patch.instructionPacketHash ?? this.runtimeSnapshot?.instructionPacketHash,
            instructionPacket: patch.instructionPacket ?? this.runtimeSnapshot?.instructionPacket,
            executionMode: patch.executionMode ?? this.runtimeSnapshot?.executionMode ?? 'manual-low-level',
            executionLedger,
            plannerApplied: patch.plannerApplied ?? this.runtimeSnapshot?.plannerApplied ?? false,
            tokenOptimizationApplied: patch.tokenOptimizationApplied ?? this.runtimeSnapshot?.tokenOptimizationApplied ?? false,
            bootstrapCalled: patch.bootstrapCalled ?? this.runtimeSnapshot?.bootstrapCalled ?? false,
            orchestrateCalled: patch.orchestrateCalled ?? this.runtimeSnapshot?.orchestrateCalled ?? false,
            plannerCalled: patch.plannerCalled ?? this.runtimeSnapshot?.plannerCalled ?? false,
            skipReasons,
            lastToolCalls: patch.lastToolCalls ?? this.runtimeSnapshot?.lastToolCalls ?? [],
            clientInstructionStatus: patch.clientInstructionStatus ?? this.runtimeSnapshot?.clientInstructionStatus,
            sequenceCompliance: patch.sequenceCompliance ?? this.runtimeSnapshot?.sequenceCompliance,
        };
        nextSnapshot.sequenceCompliance = this.deriveSequenceCompliance(nextSnapshot);
        this.runtimeSnapshot = this.runtimeRegistry.write(nextSnapshot);
        return this.runtimeSnapshot;
    }

    private markUsage(category: RuntimeUsageCategory, patch: {
        summary?: string;
        details?: string[];
        count?: number;
    } = {}): void {
        const now = Date.now();
        const current = this.runtimeSnapshot.usage[category] ?? { status: 'unused' as const };
        this.persistRuntimeSnapshot({
            lastHeartbeatAt: now,
            lastActivityAt: now,
            libraries: this.collectLibraryCounts(),
            usage: {
                ...this.runtimeSnapshot.usage,
                [category]: {
                    ...current,
                    status: 'used',
                    lastUsedAt: now,
                    summary: patch.summary ?? current.summary,
                    details: patch.details ?? current.details,
                    count: patch.count ?? current.count,
                },
            },
        });
    }

    private recordFederationUsage(activePeerLinks: number, knownPeers: number, tracesPublished: number, relay: NonNullable<RuntimeRegistrySnapshot['federation']>['relay']): void {
        const now = Date.now();
        this.persistRuntimeSnapshot({
            lastHeartbeatAt: now,
            lastActivityAt: now,
            federation: {
                activePeerLinks,
                knownPeers,
                tracesPublished,
                relay,
            },
            usage: {
                ...this.runtimeSnapshot.usage,
                federation: {
                    status: 'used',
                    lastUsedAt: now,
                    summary: relay.configured ? `${activePeerLinks} active links` : 'Relay unconfigured',
                    details: [relay.mode, relay.lastError || 'healthy'],
                    count: knownPeers,
                },
            },
        });
    }

    private attachLatestRun(runId: string, goal: string, state: string): void {
        const now = Date.now();
        this.persistRuntimeSnapshot({
            lastHeartbeatAt: now,
            lastActivityAt: now,
            latestRun: { runId, goal, state, updatedAt: now },
            libraries: this.collectLibraryCounts(),
        });
    }

    private recordRunTokenTelemetry(telemetry: RuntimeTokenRunSnapshot): RuntimeTokenSummarySnapshot {
        const current = this.runtimeSnapshot.tokens ?? createEmptyTokenSummary();
        const previous = current.timeline.find((entry) => entry.runId === telemetry.runId);
        const timeline = [telemetry, ...current.timeline.filter((entry) => entry.runId !== telemetry.runId)].slice(0, 40);
        const byPhase = this.mergeTokenBreakdown(current.byPhase, telemetry.byPhase, previous?.byPhase);
        const bySubsystem = this.mergeTokenBreakdown(current.bySubsystem, telemetry.bySubsystem, previous?.bySubsystem);
        const bySourceClass = this.mergeTokenBreakdown(current.bySourceClass, telemetry.bySourceClass, previous?.bySourceClass);
        const grossInputTokens = Math.max(0, current.grossInputTokens - (previous?.grossInputTokens ?? 0) + telemetry.grossInputTokens);
        const compressedTokens = Math.max(0, current.compressedTokens - (previous?.compressedTokens ?? 0) + telemetry.compressedTokens);
        const savedTokens = Math.max(0, current.savedTokens - (previous?.savedTokens ?? 0) + telemetry.savedTokens);
        const forwardedTokens = Math.max(0, current.forwardedTokens - (previous?.forwardedTokens ?? 0) + telemetry.forwardedTokens);
        const totalRuns = previous ? current.totalRuns : current.totalRuns + 1;
        const totalEvents = Math.max(0, current.totalEvents - (previous ? Object.keys(previous.byPhase).length : 0) + Object.keys(telemetry.byPhase).length);
        const tokens: RuntimeTokenSummarySnapshot = {
            grossInputTokens,
            compressedTokens,
            savedTokens,
            forwardedTokens,
            compressionPct: grossInputTokens > 0 ? Math.round((savedTokens / grossInputTokens) * 100) : 0,
            totalRuns,
            totalEvents,
            byPhase,
            bySubsystem,
            bySourceClass,
            timeline,
            lastUpdatedAt: Date.now(),
        };
        this.persistRuntimeSnapshot({
            tokens,
            lastHeartbeatAt: Date.now(),
            lastActivityAt: Date.now(),
        });
        return tokens;
    }

    private mergeTokenBreakdown(base: Record<string, number>, next: Record<string, number>, previous?: Record<string, number>): Record<string, number> {
        const merged: Record<string, number> = { ...(base ?? {}) };
        for (const [key, value] of Object.entries(previous ?? {})) {
            merged[key] = Math.max(0, (merged[key] ?? 0) - Number(value || 0));
            if (merged[key] === 0) delete merged[key];
        }
        for (const [key, value] of Object.entries(next ?? {})) {
            merged[key] = (merged[key] ?? 0) + Number(value || 0);
        }
        return merged;
    }

    private buildRunTokenTelemetry(run: ExecutionRun, plan: ReadingPlan, memoryMatches: string[]): RuntimeTokenRunSnapshot {
        const plannerTokens = estimateTokenCount(JSON.stringify(run.plannerState ?? run.plannerResult ?? {}));
        const memoryTokens = memoryMatches.reduce((sum, match) => sum + estimateTokenCount(match), 0);
        const grossPlanTokens = Math.max(0, Number(plan.totalEstimatedTokens || 0) + Number(plan.savings || 0));
        const compressedPlanTokens = Math.max(0, Number(plan.totalEstimatedTokens || 0));
        const contextTokens = run.workerManifests.reduce((sum, manifest) => sum + estimateTokenCount(renderWorkerContextMarkdown(manifest.context)), 0);
        const verificationTokens = run.verificationResults.reduce((sum, verification) => sum + verification.commands.reduce((commandSum, command) => (
            commandSum
            + estimateTokenCount(command.command)
            + estimateTokenCount(command.stdout)
            + estimateTokenCount(command.stderr)
        ), 0), 0);
        const continuationTokens = run.continuationChildren.reduce((sum, child) => sum + estimateTokenCount(`${child.automationId}:${child.status}:${child.runId ?? ''}:${child.error ?? ''}`), 0);
        const knowledgeFabric = run.knowledgeFabric;
        const ragTokens = knowledgeFabric?.rag.hits.reduce((sum, hit) => sum + Number(hit.tokens || 0), 0) ?? 0;
        const patternTokens = knowledgeFabric?.patterns.selected.reduce((sum, pattern) => sum + estimateTokenCount(pattern.summary), 0) ?? 0;
        const runtimeTraceTokens = knowledgeFabric ? estimateTokenCount(JSON.stringify({
            priorObjectives: knowledgeFabric.runtime.priorObjectives,
            skipReasons: knowledgeFabric.runtime.skipReasons,
            lastToolCalls: knowledgeFabric.runtime.lastToolCalls,
        })) : 0;

        const byPhase: Record<string, number> = {
            planner: plannerTokens,
            'memory-recall': memoryTokens,
            'token-optimization': compressedPlanTokens,
            'worker-handoff': contextTokens,
            verification: verificationTokens,
        };
        if (continuationTokens > 0) {
            byPhase.continuation = continuationTokens;
        }

        const bySubsystem: Record<string, number> = {
            planner: plannerTokens,
            memory: memoryTokens,
            compression: compressedPlanTokens,
            runtime: contextTokens,
            verification: verificationTokens,
        };
        if (continuationTokens > 0) {
            bySubsystem.automations = continuationTokens;
        }

        const bySourceClass: Record<string, number> = knowledgeFabric
            ? {
                repo: Math.max(0, grossPlanTokens + plannerTokens + contextTokens + verificationTokens),
                memory: memoryTokens,
                rag: ragTokens,
                patterns: patternTokens,
                runtime: Math.max(0, runtimeTraceTokens + continuationTokens),
            }
            : {
                repo: Math.max(0, grossPlanTokens + plannerTokens + contextTokens + verificationTokens),
                memory: memoryTokens,
            };

        const grossInputTokens = plannerTokens + memoryTokens + grossPlanTokens + contextTokens + verificationTokens + continuationTokens;
        const compressedTokens = plannerTokens + memoryTokens + compressedPlanTokens + contextTokens + verificationTokens + continuationTokens;
        const savedTokens = Math.max(0, grossPlanTokens - compressedPlanTokens);
        const forwardedTokens = compressedTokens;

        return {
            runId: run.runId,
            goal: run.goal,
            timestamp: Date.now(),
            grossInputTokens,
            compressedTokens,
            savedTokens,
            forwardedTokens,
            compressionPct: grossInputTokens > 0 ? Math.round((savedTokens / grossInputTokens) * 100) : 0,
            byPhase,
            bySubsystem,
            bySourceClass,
        };
    }

    private buildWorkerContext(runId: string, task: ExecutionTask, manifest: Pick<WorkerManifest, 'workerId' | 'role' | 'strategy' | 'specialistId'>, activeSkills: SkillArtifact[], activeWorkflows: WorkflowArtifact[], plannerState?: TaskPlannerState, phasePackets: WorkerPhasePacket[] = []): WorkerContextPacket {
        const specialist = manifest.specialistId ? getSpecialist(manifest.specialistId) : undefined;
        return {
            goal: task.goal,
            runtimeId: this.runtimeId,
            runId,
            workerId: manifest.workerId,
            role: manifest.role,
            strategy: manifest.strategy,
            selectedCrew: plannerState?.selectedCrew,
            specialist: {
                specialistId: specialist?.specialistId,
                name: specialist?.name,
                authority: specialist?.authority,
                division: specialist?.division,
                mission: specialist?.mission,
                rules: specialist?.rules ?? [],
                workflow: specialist?.workflow ?? [],
                deliverables: specialist?.deliverables ?? [],
            },
            activeSkills: activeSkills.map((skill) => ({
                skillId: skill.skillId,
                name: skill.name,
                riskClass: skill.riskClass,
                scope: skill.scope,
                instructions: skill.instructions,
                toolBindings: skill.toolBindings,
            })),
            activeWorkflows: activeWorkflows.map((workflow) => ({
                workflowId: workflow.workflowId,
                name: workflow.name,
                description: workflow.description,
                guardrails: workflow.guardrails,
                expectedOutputs: workflow.expectedOutputs,
                steps: workflow.steps.map((step) => step.title),
            })),
            reviewGates: plannerState?.reviewGates ?? [],
            continuation: plannerState?.continuation,
            phasePackets,
        };
    }

    private writeManifestContexts(recorder: ArtifactRecorder, manifests: WorkerManifest[]): void {
        manifests.forEach((manifest) => {
            recorder.writeJson(path.join('workers', manifest.workerId, 'context.json'), manifest.context);
            recorder.writeText(path.join('workers', manifest.workerId, 'context.md'), renderWorkerContextMarkdown(manifest.context));
        });
    }

    private writeWorktreeContext(worktreeDir: string, context: WorkerContextPacket): void {
        const runtimeDir = path.join(worktreeDir, '.agent', 'runtime');
        fs.mkdirSync(runtimeDir, { recursive: true });
        fs.writeFileSync(path.join(runtimeDir, 'context.json'), JSON.stringify(context, null, 2), 'utf8');
        fs.writeFileSync(path.join(runtimeDir, 'context.md'), renderWorkerContextMarkdown(context), 'utf8');
    }

    private writeWorktreePacket(worktreeDir: string, packet?: InstructionPacket): void {
        if (!packet) return;
        const runtimeDir = path.join(worktreeDir, '.agent', 'runtime');
        fs.mkdirSync(runtimeDir, { recursive: true });
        fs.writeFileSync(path.join(runtimeDir, 'packet.json'), JSON.stringify(packet, null, 2), 'utf8');
        fs.writeFileSync(path.join(runtimeDir, 'packet.md'), renderInstructionPacketMarkdown(packet), 'utf8');
    }

    private gatherSkillBindings(skills: SkillArtifact[], allowMutateSkills: boolean): SkillBinding[] {
        return skills.flatMap((skill) => {
            if (skill.riskClass === 'mutate' && !allowMutateSkills) {
                return [];
            }
            return skill.toolBindings;
        });
    }

    private applyPhaseHookEffects(
        runId: string,
        task: ExecutionTask,
        trigger: HookTrigger,
        result: ReturnType<HookRuntime['dispatch']>,
        run: ExecutionRun,
        manifests: WorkerManifest[],
        workflowApplication: { verifyCommands: string[]; actions: SkillBinding[]; events: Array<Record<string, unknown>> }
    ): { verifyCommands: string[]; actions: SkillBinding[] } {
        if (result.skillSelectors.length === 0 && result.workflowSelectors.length === 0 && result.toolBindings.length === 0 && result.notes.length === 0) {
            return {
                verifyCommands: workflowApplication.verifyCommands,
                actions: workflowApplication.actions,
            };
        }

        const addedSkills = dedupeSkillArtifacts(this.skillRuntime.resolveSkillSelectors(result.skillSelectors, task.goal))
            .filter((skill) => !run.activeSkills.some((active) => active.skillId === skill.skillId));
        const addedWorkflows = dedupeWorkflowArtifacts(this.workflowRuntime.resolveWorkflowSelectors(result.workflowSelectors, task.goal))
            .filter((workflow) => !run.activeWorkflows.some((active) => active.workflowId === workflow.workflowId));

        const nextSkills = dedupeSkillArtifacts([...run.activeSkills, ...addedSkills]);
        const nextWorkflows = dedupeWorkflowArtifacts([...run.activeWorkflows, ...addedWorkflows]);
        const nextApplication = this.workflowRuntime.applyToTask(
            nextWorkflows,
            workflowApplication.verifyCommands,
            [
                ...workflowApplication.actions,
                ...this.gatherSkillBindings(addedSkills, task.skillPolicy.allowMutateSkills),
                ...result.toolBindings,
            ],
        );

        run.activeSkills = nextSkills;
        run.activeWorkflows = nextWorkflows;
        run.skillEvents.push(...addedSkills.map((skill) => ({
            type: 'skill.selected',
            skillId: skill.skillId,
            name: skill.name,
            scope: skill.scope,
            riskClass: skill.riskClass,
            provenance: skill.provenance,
            trigger,
        })));
        run.workflowEvents.push(...nextApplication.events.filter((event) =>
            !run.workflowEvents.some((existing) => existing.workflowId === event.workflowId && existing.type === event.type)
        ));

        const phasePacket: WorkerPhasePacket = {
            trigger,
            notes: result.notes,
            addedSkillNames: addedSkills.map((skill) => skill.name),
            addedWorkflowNames: addedWorkflows.map((workflow) => workflow.name),
            addedBindings: result.toolBindings.map((binding) => binding.type),
        };

        manifests.forEach((manifest) => {
            manifest.inlineSkills = nextSkills;
            manifest.workflows = nextWorkflows;
            manifest.actions = manifest.role === 'coder'
                ? filterBindingsByTools(nextApplication.actions, manifest.allowedTools)
                : manifest.actions;
            manifest.verifyCommands = dedupeStrings(nextApplication.verifyCommands);
            manifest.context = this.buildWorkerContext(runId, task, manifest, nextSkills, nextWorkflows, run.plannerState, [
                ...(manifest.context?.phasePackets ?? []),
                phasePacket,
            ]);
        });

        if (addedSkills.length > 0) {
            this.markUsage('skills', {
                summary: `${trigger} injected ${addedSkills.length} skill(s)`,
                count: nextSkills.length,
                details: addedSkills.map((skill) => skill.name),
            });
        }
        if (addedWorkflows.length > 0) {
            this.markUsage('workflows', {
                summary: `${trigger} injected ${addedWorkflows.length} workflow(s)`,
                count: nextWorkflows.length,
                details: addedWorkflows.map((workflow) => workflow.name),
            });
        }
        if (result.toolBindings.length > 0) {
            this.markUsage('hooks', {
                summary: `${trigger} added ${result.toolBindings.length} binding(s)`,
                count: result.toolBindings.length,
                details: result.toolBindings.map((binding) => binding.type),
            });
        }

        return {
            verifyCommands: dedupeStrings(nextApplication.verifyCommands),
            actions: nextApplication.actions,
        };
    }

    private evaluateReviewGates(run: ExecutionRun): ReviewGateResult[] {
        const verified = run.verificationResults.every((result) => result.passed);
        return (run.plannerState?.reviewGates ?? []).map((gate) => ({
            ...gate,
            status: verified ? 'ready' : 'blocked',
            rationale: verified
                ? `${gate.rationale} Runtime verification satisfied this gate.`
                : `${gate.rationale} Runtime verification or hook checks did not complete cleanly.`,
        }));
    }

    private async executeAutomationContinuations(
        run: ExecutionRun,
        dispatches: Awaited<ReturnType<AutomationRuntime['dispatch']>>,
        task: Pick<ExecutionTask, 'continuationDepth' | 'sourceAutomationId'>,
    ): Promise<ExecutionRun[]> {
        const children: ExecutionRun[] = [];
        const maxDepth = 1;
        for (const dispatch of dispatches) {
            if (!dispatch.queuedRun) continue;
            if (task.continuationDepth >= maxDepth) {
                run.continuationChildren.push({
                    automationId: dispatch.automationId,
                    status: 'suppressed',
                    error: 'continuation-depth-limit',
                });
                continue;
            }

            if (task.sourceAutomationId && task.sourceAutomationId === dispatch.automationId) {
                run.continuationChildren.push({
                    automationId: dispatch.automationId,
                    status: 'suppressed',
                    error: 'source-automation-suppressed',
                });
                continue;
            }

            run.continuationChildren.push({
                automationId: dispatch.automationId,
                status: 'queued',
            });

            try {
                const childRun = await this.run({
                    goal: dispatch.queuedRun.goal,
                    workflowSelectors: dispatch.queuedRun.workflowSelectors,
                    skillNames: dispatch.queuedRun.skillSelectors,
                    hookSelectors: dispatch.queuedRun.hookSelectors,
                    workers: 2,
                    parentRunId: run.runId,
                    sourceAutomationId: dispatch.automationId,
                    continuationDepth: task.continuationDepth + 1,
                    suppressedAutomationIds: [dispatch.automationId],
                });
                run.continuationChildren[run.continuationChildren.length - 1] = {
                    automationId: dispatch.automationId,
                    runId: childRun.runId,
                    status: 'completed',
                };
                children.push(childRun);
            } catch (error) {
                run.continuationChildren[run.continuationChildren.length - 1] = {
                    automationId: dispatch.automationId,
                    status: 'failed',
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        }
        return children;
    }

    private resolveCompressionBackend(task: ExecutionTask): CompressionBackend {
        return resolveBackend(this.backendRegistry.compression, task.backendSelectors.compressionBackend, 'deterministic-token-supremacy').selected;
    }
}

async function runCommand(cwd: string, command: string, allowFailure: boolean = false): Promise<CommandRecord> {
    try {
        const { stdout, stderr } = await exec(command, {
            cwd,
            maxBuffer: 1024 * 1024 * 20,
        });
        return { command, cwd, exitCode: 0, stdout, stderr };
    } catch (error: any) {
        const record: CommandRecord = {
            command,
            cwd,
            exitCode: typeof error?.code === 'number' ? error.code : 1,
            stdout: String(error?.stdout ?? ''),
            stderr: String(error?.stderr ?? error?.message ?? ''),
        };
        if (!allowFailure) throw new Error(record.stderr || record.stdout || `Command failed: ${command}`);
        return record;
    }
}

function scanFiles(repoRoot: string): FileRef[] {
    const candidates = [
        path.join(repoRoot, 'src'),
        path.join(repoRoot, 'test'),
        path.join(repoRoot, 'README.md'),
    ];
    const files: FileRef[] = [];

    const visit = (target: string) => {
        if (!fs.existsSync(target)) return;
        const stat = fs.statSync(target);
        if (stat.isFile()) {
            files.push({
                path: target,
                sizeBytes: stat.size,
                lastModified: stat.mtimeMs,
            });
            return;
        }

        for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.git')) continue;
            visit(path.join(target, entry.name));
        }
    };

    candidates.forEach(visit);
    return files;
}

function isMemoryBackend(value: unknown): value is MemoryBackend {
    return !!value && typeof value === 'object' && 'descriptor' in (value as Record<string, unknown>);
}

function looksLikePatch(diff: string): boolean {
    return diff.includes('diff --git') || diff.includes('@@ ') || diff.includes('+++ ');
}

function sanitizeFileName(value: string): string {
    return value.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'command';
}

function relativeTo(root: string, target: string): string {
    const rel = path.relative(root, target);
    return rel.startsWith('..') ? target : rel;
}

function quote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function dedupeStrings(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function dedupeSkillArtifacts(values: SkillArtifact[]): SkillArtifact[] {
    const seen = new Set<string>();
    return values.filter((value) => {
        const key = value.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function dedupeWorkflowArtifacts(values: WorkflowArtifact[]): WorkflowArtifact[] {
    const seen = new Set<string>();
    return values.filter((value) => {
        const key = value.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function dedupeHookArtifacts(values: HookArtifact[]): HookArtifact[] {
    const seen = new Set<string>();
    return values.filter((value) => {
        const key = value.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function dedupeAutomationArtifacts(values: AutomationArtifact[]): AutomationArtifact[] {
    const seen = new Set<string>();
    return values.filter((value) => {
        const key = value.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function scopedTools(allowedTools: string[] | undefined, defaults: string[]): string[] {
    if (!allowedTools || allowedTools.length === 0) {
        return defaults;
    }

    const scoped = defaults.filter((tool) => allowedTools.includes(tool));
    return scoped.length > 0 ? scoped : defaults;
}

function filterBindingsByTools(bindings: SkillBinding[], allowedTools: string[]): SkillBinding[] {
    const allowed = new Set(allowedTools);
    return bindings.filter((binding) => allowed.has(binding.type));
}

function renderWorkerContextMarkdown(context: WorkerContextPacket): string {
    return [
        `# Worker Context`,
        '',
        `- Runtime: ${context.runtimeId}`,
        `- Run: ${context.runId}`,
        `- Worker: ${context.workerId}`,
        `- Role: ${context.role}`,
        `- Strategy: ${context.strategy}`,
        context.selectedCrew ? `- Crew: ${context.selectedCrew.name}` : '',
        '',
        '## Goal',
        context.goal,
        '',
        '## Specialist',
        context.specialist.name ? `- Name: ${context.specialist.name}` : '- Name: unassigned',
        context.specialist.mission ? `- Mission: ${context.specialist.mission}` : '',
        context.specialist.rules.length ? `- Rules: ${context.specialist.rules.join(' | ')}` : '',
        context.specialist.workflow.length ? `- Workflow: ${context.specialist.workflow.join(' | ')}` : '',
        context.specialist.deliverables.length ? `- Deliverables: ${context.specialist.deliverables.join(' | ')}` : '',
        '',
        '## Active Skills',
        ...(context.activeSkills.length
            ? context.activeSkills.map((skill) => `- ${skill.name} (${skill.riskClass})${skill.toolBindings.length ? ` [${skill.toolBindings.map((binding) => binding.type).join(', ')}]` : ''}`)
            : ['- none']),
        '',
        '## Active Workflows',
        ...(context.activeWorkflows.length
            ? context.activeWorkflows.map((workflow) => `- ${workflow.name}: ${workflow.description}`)
            : ['- none']),
        '',
        '## Review Gates',
        ...(context.reviewGates.length
            ? context.reviewGates.map((gate) => `- ${gate.gate}: ${gate.status} (${gate.owner})`)
            : ['- none']),
        '',
        '## Phase Additions',
        ...(context.phasePackets.length
            ? context.phasePackets.map((packet) => `- ${packet.trigger}: skills=${packet.addedSkillNames.join(', ') || 'none'} workflows=${packet.addedWorkflowNames.join(', ') || 'none'} bindings=${packet.addedBindings.join(', ') || 'none'}`)
            : ['- none']),
    ].filter(Boolean).join('\n');
}

function estimateTokenCount(value: unknown): number {
    if (typeof value !== 'string') {
        try {
            return Math.ceil(JSON.stringify(value ?? '').length / 4);
        } catch {
            return 0;
        }
    }
    return Math.ceil(value.length / 4);
}

function extractRunTimestamp(run: ExecutionRun): number {
    const match = run.runId.match(/(\d{13})/);
    if (match) {
        return Number(match[1]);
    }
    try {
        return fs.statSync(run.artifactsPath).mtimeMs;
    } catch {
        return 0;
    }
}

function toKnowledgeFabricSnapshot(bundle: KnowledgeFabricBundle): KnowledgeFabricSnapshot {
    return {
        runtimeId: bundle.runtimeId,
        sessionId: bundle.sessionId,
        generatedAt: bundle.generatedAt,
        task: bundle.task,
        sourceMix: bundle.sourceMix,
        tokenBudget: bundle.tokenBudget,
        attachedCollections: bundle.rag.attachedCollections,
        patternHits: bundle.patterns.selected.map((pattern) => ({
            patternId: pattern.patternId,
            name: pattern.name,
            score: pattern.score,
        })),
        selectedFiles: bundle.repo.selectedFiles,
        candidateFiles: bundle.repo.candidateFiles,
        recommendations: bundle.recommendations,
        modelTierPolicy: bundle.modelTierPolicy,
        modelTierTrace: bundle.modelTierTrace,
        provenance: bundle.provenance,
        summary: bundle.summary,
    };
}

export function summarizeExecution(run: ExecutionRun): string {
    const verified = run.workerResults.filter(result => result.verified).length;
    return `${run.state.toUpperCase()} — ${run.goal} (${run.workerResults.length} worker(s), ${verified} verified)`;
}

export function executionStats(run: ExecutionRun): {
    verifiedWorkers: number;
    modifiedFiles: number;
    totalLearnings: number;
    memoryStats?: MemoryStats | Record<string, unknown>;
} {
    return {
        verifiedWorkers: run.workerResults.filter(result => result.verified).length,
        modifiedFiles: run.workerResults.reduce((sum, result) => sum + result.modifiedFiles.length, 0),
        totalLearnings: run.workerResults.reduce((sum, result) => sum + result.learnings.length, 0),
    };
}

export const createSubAgentRuntime = (options?: SubAgentRuntimeOptions) =>
    new SubAgentRuntime(options);
