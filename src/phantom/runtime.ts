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
import { nexusEventBus } from '../engines/event-bus.js';
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
    targetWorkerId?: string;
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
    private runs = new Map<string, ExecutionRun>();

    constructor(options: SubAgentRuntimeOptions = {}) {
        this.repoRoot = options.repoRoot ?? process.cwd();
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
    }

    async run(input: Partial<ExecutionTask> & { goal: string }): Promise<ExecutionRun> {
        const runId = buildRunId('exec');
        const recorder = new ArtifactRecorder(runId, this.artifactsRoot);
        const task = await this.normalizeTask(input);
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
        };
        this.runs.set(runId, run);

        recorder.writeJson('task.json', task);
        this.sessionDNA?.recordDecision('Execution task accepted', task.goal, 0.8);
        const localPeer = this.federation.heartbeat(`runtime-${runId}`, {
            displayName: `Runtime ${runId}`,
            source: 'local',
            capabilities: ['runtime', 'skills', 'workflows', 'hooks', 'automations'],
            trust: 'high',
        });
        run.federationState = this.federation.getSnapshot();
        recorder.writeJson('federation-bootstrap.json', { localPeer, snapshot: run.federationState });

        const guardAction = `execute: ${task.goal}; verify=${task.verifyCommands.join(', ')}`;
        const guardrail = this.guardrails.check({
            action: guardAction,
            filesToModify: task.files,
            tokenCount: 2500 + task.files.length * 300,
            isDestructive: false,
        });
        recorder.writeJson('guardrail.json', guardrail);
        nexusEventBus.emit('guardrail.check', { action: guardAction, passed: guardrail.passed, score: guardrail.score });
        if (!guardrail.passed) {
            run.state = 'failed';
            run.mode = 'analysis';
            run.result = 'Guardrails blocked execution.';
            recorder.writeJson('run.json', run);
            return run;
        }

        run.state = 'bootstrapping';

        const fileRefs = task.files.length > 0
            ? this.resolveFileRefs(task.files)
            : this.discoverTargetFiles(task.goal, backends.compression.selected);
        const memoryMatches = await backends.memory.selected.recall(task.goal, 6);
        const planResult = normalizeReadingPlan(backends.compression.selected.planFiles(task.goal, fileRefs));
        const plan = planResult.plan;
        run.backendEvidence.memory = await (backends.memory.selected.shadowRecall?.(task.goal, 6) ?? Promise.resolve({ recalled: memoryMatches }));
        run.backendEvidence.compression = await backends.compression.selected.shadow(task.goal, fileRefs);
        run.backendEvidence.notes.push(...planResult.notes);
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
            [...task.actions, ...preReadHooks.toolBindings, ...beforeReadHooks.toolBindings],
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

        const manifests = this.createWorkerManifests(task, fileRefs, plan, activeSkills, activeWorkflows, effectiveActions, effectiveVerifyCommands);
        run.workerManifests = manifests;
        run.plannerResult = this.createPlannerResult(task, manifests, fileRefs, domainMatches);
        recorder.writeJson('planner-result.json', run.plannerResult);
        recorder.writeJson('manifests.json', manifests);

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
            recorder.writeJson('run.json', run);
            return run;
        }

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

        run.state = 'verifying';
        const verifierManifests = manifests.filter((manifest) => manifest.role === 'verifier');
        const verificationResults = await Promise.all(verifierManifests.map((manifest) => this.runVerifierWorker(runId, recorder, manifest, coderResults.find((result) => result.workerId === manifest.targetWorkerId))));
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
            bindings: effectiveActions,
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

        const applied = preApplyShield.blocked
            ? { applied: false, rolledBack: false, summary: preApplyShield.summary }
            : await this.applyDecision(recorder, { ...task, verifyCommands: effectiveVerifyCommands }, decision, consensusPolicy);
        run.state = applied.applied
            ? (applied.rolledBack ? 'rolled_back' : 'merged')
            : 'failed';
        run.result = applied.summary;

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
        run.federationState = this.federation.getSnapshot();
        recorder.writeJson('federation-final.json', run.federationState);
        if (this.memoryEngine) {
            const audit = this.memoryEngine.audit(40);
            nexusEventBus.emit('memory.audit', {
                scanned: audit.scanned,
                quarantined: audit.quarantined.length,
            });
        }
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
            workers: 1,
        });
    }

    auditMemory(limit: number = 80): ReturnType<MemoryEngine['audit']> | undefined {
        return this.memoryEngine?.audit(limit);
    }

    listMemoryQuarantine(limit: number = 40): ReturnType<MemoryEngine['listQuarantined']> {
        return this.memoryEngine?.listQuarantined(limit) ?? [];
    }

    getNetworkStatus(): unknown {
        return this.federation.getSnapshot();
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
        });
    }

    getBackendCatalog(): Record<string, unknown> {
        return {
            memory: [...this.backendRegistry.memory.values()].map((backend) => backend.descriptor),
            compression: [...this.backendRegistry.compression.values()].map((backend) => backend.descriptor),
            dsl: [...this.backendRegistry.dsl.values()].map((backend) => backend.descriptor),
            consensus: [{ kind: 'multi-tier-byzantine', mode: 'default' }],
            hooks: this.hookRuntime.listArtifacts().map((hook) => ({ hookId: hook.hookId, name: hook.name, trigger: hook.trigger })),
            automations: this.automationRuntime.listArtifacts().map((automation) => ({ automationId: automation.automationId, name: automation.name, triggerMode: automation.triggerMode })),
        };
    }

    getHealth(): Record<string, unknown> {
        return {
            runtime: 'healthy',
            runsTracked: this.runs.size,
            skills: this.skillRuntime.listArtifacts().length,
            workflows: this.workflowRuntime.listArtifacts().length,
            hooks: this.hookRuntime.listArtifacts().length,
            automations: this.automationRuntime.listArtifacts().length,
            shield: 'balanced',
            federation: this.federation.getSnapshot(),
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
            workers: Math.max(1, Math.min(input.workers ?? 2, 7)),
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
        verifyCommands: string[]
    ): WorkerManifest[] {
        const workerIds = new Array(task.workers).fill(null).map((_, idx) => `coder-${idx + 1}`);
        const budgets = this.resolveCompressionBackend(task).allocateWorkerBudget(workerIds, plan);
        const sessionSkillIds = activeSkills.map(skill => skill.skillId);
        const workflowIds = activeWorkflows.map((workflow) => workflow.workflowId);

        const manifests: WorkerManifest[] = [
            {
                workerId: 'planner-1',
                role: 'planner',
                strategy: 'plan',
                worktreeDir: null,
                files,
                skillOverlays: { base: task.skillNames, session: sessionSkillIds, worker: [], runtimeHot: sessionSkillIds },
                workflowOverlays: workflowIds,
                allowedTools: ['read_file', 'run_command'],
                tokenBudget: Math.max(200, Math.round(plan.totalEstimatedTokens * 0.3)),
                verifyCommands,
                checkpoints: task.checkpointPolicy,
                actions: [],
                inlineSkills: activeSkills,
                workflows: activeWorkflows,
            },
            {
                workerId: 'skill-maker-1',
                role: 'skill-maker',
                strategy: 'derive',
                worktreeDir: null,
                files,
                skillOverlays: { base: task.skillNames, session: sessionSkillIds, worker: [], runtimeHot: sessionSkillIds },
                workflowOverlays: workflowIds,
                allowedTools: ['read_file', 'write_file'],
                tokenBudget: 240,
                verifyCommands,
                checkpoints: task.checkpointPolicy,
                actions: [],
                inlineSkills: activeSkills,
                workflows: activeWorkflows,
            },
            {
                workerId: 'research-shadow-1',
                role: 'research-shadow',
                strategy: task.backendMode,
                worktreeDir: null,
                files,
                skillOverlays: { base: task.skillNames, session: sessionSkillIds, worker: [], runtimeHot: sessionSkillIds },
                workflowOverlays: workflowIds,
                allowedTools: ['read_file', 'run_command'],
                tokenBudget: 240,
                verifyCommands,
                checkpoints: task.checkpointPolicy,
                actions: [],
                inlineSkills: activeSkills,
                workflows: activeWorkflows,
            },
        ];

        workerIds.forEach((workerId, idx) => {
            manifests.push({
                workerId,
                role: 'coder',
                strategy: task.strategies[idx % task.strategies.length],
                worktreeDir: null,
                files,
                skillOverlays: {
                    base: task.skillNames,
                    session: sessionSkillIds,
                    worker: [],
                    runtimeHot: sessionSkillIds,
                },
                workflowOverlays: workflowIds,
                allowedTools: ['write_file', 'append_file', 'replace_text', 'run_command'],
                tokenBudget: budgets.get(workerId) ?? 500,
                verifyCommands,
                checkpoints: task.checkpointPolicy,
                actions,
                inlineSkills: activeSkills,
                workflows: activeWorkflows,
            });
            manifests.push({
                workerId: `verifier-${idx + 1}`,
                role: 'verifier',
                strategy: `verify-${task.strategies[idx % task.strategies.length]}`,
                worktreeDir: null,
                files,
                skillOverlays: {
                    base: task.skillNames,
                    session: sessionSkillIds,
                    worker: [],
                    runtimeHot: sessionSkillIds,
                },
                workflowOverlays: workflowIds,
                allowedTools: ['run_command'],
                tokenBudget: Math.max(200, Math.round((budgets.get(workerId) ?? 500) * 0.4)),
                verifyCommands,
                checkpoints: task.checkpointPolicy,
                actions: [],
                inlineSkills: activeSkills,
                workflows: activeWorkflows,
                targetWorkerId: workerId,
            });
        });

        return manifests;
    }

    private createPlannerResult(task: ExecutionTask, manifests: WorkerManifest[], files: FileRef[], domains: string[]): PlannerResult {
        return {
            summary: `Planner assigned ${manifests.filter((manifest) => manifest.role === 'coder').length} coder worker(s) and ${manifests.filter((manifest) => manifest.role === 'verifier').length} verifier worker(s).`,
            domains,
            selectedFiles: files.map((file) => path.relative(this.repoRoot, file.path) || file.path),
            selectedWorkflows: task.workflowSelectors,
            strategyMap: manifests
                .filter((manifest) => manifest.role === 'coder')
                .map((manifest) => ({ workerId: manifest.workerId, strategy: manifest.strategy })),
            risks: [
                task.verifyCommands.length === 0 ? 'No verification commands configured.' : 'Verification required before merge.',
                task.skillPolicy.allowMutateSkills ? 'Mutate skills enabled.' : 'Mutate skills remain gated.',
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
            manifest.files.forEach(file => this.sessionDNA?.recordFileAccess(file.path));

            const readSkills = manifest.inlineSkills.filter(skill => skill.riskClass === 'read');
            for (const skill of readSkills) {
                this.sessionDNA?.recordSkill(skill.name);
                this.skillRuntime.deploy(skill, manifest.workerId, session.worktreeDir, 'before-read');
                learnings.push(`Activated read skill: ${skill.name}`);
            }

            const orchestrateSkills = manifest.inlineSkills.filter(skill => skill.riskClass === 'orchestrate');
            for (const skill of orchestrateSkills) {
                this.sessionDNA?.recordSkill(skill.name);
                this.skillRuntime.deploy(skill, manifest.workerId, session.worktreeDir, 'before-mutate');
                learnings.push(`Activated orchestrate skill: ${skill.name}`);
            }

            const modifiedFiles = await session.applyBindings(manifest.actions);
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
