import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { GuardrailEngine } from '../engines/guardrails-bridge.js';
import type { MemoryStats } from '../engines/memory.js';
import { MemoryEngine } from '../engines/memory.js';
import { SessionDNAManager } from '../engines/session-dna.js';
import {
    type CompressionBackend,
    type CompressionShadow,
    type DSLCompilationResult,
    type DSLCompilerBackend,
    type DSLExecutionSpec,
    type MemoryBackend,
    buildRunId,
    createDeterministicCompressionBackend,
    createDeterministicDSLCompilerBackend,
    createSQLiteMemoryBackend,
} from '../engines/runtime-backends.js';
import {
    SkillRuntime,
    createSkillRuntime,
    type SkillArtifact,
    type SkillBinding,
    type SkillCheckpoint,
} from '../engines/skill-runtime.js';
import { ByzantineConsensus } from '../engines/byzantine-consensus.js';
import { podNetwork } from '../engines/pod-network.js';
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
    actions: SkillBinding[];
    inlineSkills: SkillArtifact[];
    nxlScript?: string;
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
    allowedTools: string[];
    tokenBudget: number;
    verifyCommands: string[];
    checkpoints: SkillCheckpoint[];
    actions: SkillBinding[];
    inlineSkills: SkillArtifact[];
}

export interface CommandRecord {
    command: string;
    cwd: string;
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface WorkerVerification {
    passed: boolean;
    commands: CommandRecord[];
    summary: string;
}

export interface RuntimeWorkerResult extends WorkerResult {
    role: WorkerRole;
    verified: boolean;
    verification?: WorkerVerification;
    artifactsPath: string;
    modifiedFiles: string[];
}

export interface ExecutionShadowMetrics {
    memory: Record<string, unknown>;
    compression: Record<string, unknown> | CompressionShadow;
    consensus: Record<string, unknown>;
    dsl?: Record<string, unknown>;
}

export interface ExecutionRun {
    runId: string;
    state: ExecutionState;
    mode: ExecutionMode;
    goal: string;
    artifactsPath: string;
    workerManifests: WorkerManifest[];
    activeSkills: SkillArtifact[];
    selectedBackends: BackendSelection;
    finalDecision?: MergeDecision;
    workerResults: RuntimeWorkerResult[];
    shadow: ExecutionShadowMetrics;
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
    artifactsRoot?: string;
}

class ArtifactRecorder {
    readonly runDir: string;

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
        return target;
    }

    writeText(relativePath: string, value: string): string {
        const target = path.join(this.runDir, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, value, 'utf-8');
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
        try {
            const { stdout, stderr } = await exec(command, {
                cwd: this.worktreeDir,
                maxBuffer: 1024 * 1024 * 20,
            });
            return { command, cwd: this.worktreeDir, exitCode: 0, stdout, stderr };
        } catch (error: any) {
            const record: CommandRecord = {
                command,
                cwd: this.worktreeDir,
                exitCode: typeof error?.code === 'number' ? error.code : 1,
                stdout: String(error?.stdout ?? ''),
                stderr: String(error?.stderr ?? error?.message ?? ''),
            };
            if (!allowFailure) throw new Error(record.stderr || record.stdout || `Command failed: ${command}`);
            return record;
        }
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
                // Runtime skill overlays live under .agent and should not enter repo patches.
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
    private memoryBackend: MemoryBackend;
    private compressionBackend: CompressionBackend;
    private dslCompiler: DSLCompilerBackend;
    private guardrails: GuardrailEngine;
    private sessionDNA?: SessionDNAManager;
    private skillRuntime: SkillRuntime;
    private artifactsRoot?: string;
    private consensusPolicy: MultiTierConsensusPolicy;

    constructor(options: SubAgentRuntimeOptions = {}) {
        this.repoRoot = options.repoRoot ?? process.cwd();
        this.memoryBackend = isMemoryBackend(options.memory)
            ? options.memory
            : createSQLiteMemoryBackend((options.memory as MemoryEngine | undefined) ?? new MemoryEngine());
        this.compressionBackend = options.compressionBackend ?? createDeterministicCompressionBackend();
        this.dslCompiler = options.dslCompiler ?? createDeterministicDSLCompilerBackend();
        this.guardrails = options.guardrails ?? new GuardrailEngine();
        this.sessionDNA = options.sessionDNA;
        this.skillRuntime = options.skillRuntime ?? createSkillRuntime();
        this.artifactsRoot = options.artifactsRoot;
        this.consensusPolicy = new MultiTierConsensusPolicy(this.memoryBackend);
    }

    async run(input: Partial<ExecutionTask> & { goal: string }): Promise<ExecutionRun> {
        const runId = buildRunId('exec');
        const recorder = new ArtifactRecorder(runId, this.artifactsRoot);
        const task = await this.normalizeTask(input);
        const selectedBackends = this.resolveBackends(task);
        const run: ExecutionRun = {
            runId,
            state: 'planned',
            mode: 'real',
            goal: task.goal,
            artifactsPath: recorder.runDir,
            workerManifests: [],
            activeSkills: [],
            selectedBackends,
            workerResults: [],
            shadow: {
                memory: {},
                compression: {},
                consensus: {},
            },
            result: '',
        };

        this.sessionDNA?.recordDecision('Execution task accepted', task.goal, 0.8);
        recorder.writeJson('task.json', task);

        const guardAction = `execute: ${task.goal}; verify=${task.verifyCommands.join(', ')}`;
        const guardrail = this.guardrails.check({
            action: guardAction,
            filesToModify: task.files,
            tokenCount: 2500 + task.files.length * 300,
            isDestructive: false,
        });
        recorder.writeJson('guardrail.json', guardrail);
        if (!guardrail.passed) {
            run.state = 'failed';
            run.mode = 'analysis';
            run.result = 'Guardrails blocked execution.';
            return run;
        }

        run.state = 'bootstrapping';

        const fileRefs = task.files.length > 0
            ? this.resolveFileRefs(task.files)
            : this.discoverTargetFiles(task.goal);
        const plan = this.compressionBackend.planFiles(task.goal, fileRefs);
        run.shadow.memory = await (this.memoryBackend.shadowRecall?.(task.goal, 5) ?? Promise.resolve({}));
        run.shadow.compression = await this.compressionBackend.shadow(task.goal, fileRefs);
        recorder.writeJson('reading-plan.json', plan);

        const generatedSkills = this.skillRuntime.generateRuntimeSkills(task.goal, task.workers);
        const stagedSkills = [...generatedSkills, ...task.inlineSkills];
        run.activeSkills = stagedSkills;
        recorder.writeJson('skills.json', stagedSkills);

        const manifests = this.createWorkerManifests(task, fileRefs, plan, stagedSkills);
        run.workerManifests = manifests;
        recorder.writeJson('manifests.json', manifests);

        this.consensusPolicy.registerAgents(manifests.map(m => m.workerId));

        run.state = 'running';
        const workerResults = await Promise.all(
            manifests
                .filter(manifest => manifest.role === 'coder')
                .map(manifest => this.runCoderWorker(runId, recorder, manifest))
        );
        run.workerResults = workerResults;
        recorder.writeJson('worker-results.json', workerResults);

        run.state = 'verifying';
        const decision = await this.consensusPolicy.merge(workerResults);
        run.finalDecision = decision;
        run.shadow.consensus = this.consensusPolicy.shadowStats();
        recorder.writeJson('decision.json', decision);

        const applied = await this.applyDecision(recorder, task, decision);
        run.state = applied.applied
            ? (applied.rolledBack ? 'rolled_back' : 'merged')
            : 'failed';
        run.result = applied.summary;
        recorder.writeJson('run.json', run);
        this.sessionDNA?.recordDecision('Execution completed', applied.summary, applied.applied ? 0.86 : 0.42);

        return run;
    }

    async runNXL(goal: string, rawScript?: string, useCase?: string): Promise<ExecutionRun> {
        const compiled = this.dslCompiler.compile(goal, rawScript, useCase);
        return this.run(this.executionTaskFromCompiled(compiled, rawScript));
    }

    private async normalizeTask(input: Partial<ExecutionTask> & { goal: string }): Promise<ExecutionTask> {
        const task: ExecutionTask = {
            goal: input.goal,
            files: input.files ?? [],
            workers: Math.max(1, Math.min(input.workers ?? 2, 7)),
            roles: input.roles ?? ['planner', 'coder', 'verifier'],
            strategies: input.strategies ?? ['minimal', 'standard', 'thorough'],
            verifyCommands: input.verifyCommands ?? this.defaultVerifyCommands(),
            successCriteria: input.successCriteria ?? ['Verified diff applied successfully'],
            rollbackPolicy: 'patch-revert',
            timeoutMs: input.timeoutMs ?? 120000,
            skillPolicy: input.skillPolicy ?? { mode: 'guarded-hot', allowMutateSkills: false },
            backendSelectors: input.backendSelectors ?? {},
            skillNames: input.skillNames ?? [],
            actions: input.actions ?? [],
            inlineSkills: input.inlineSkills ?? [],
            nxlScript: input.nxlScript,
        };

        if (input.nxlScript && (!input.actions || input.actions.length === 0)) {
            const compiled = this.dslCompiler.compile(task.goal, input.nxlScript);
            const compiledTask = this.executionTaskFromCompiled(compiled, input.nxlScript);
            return {
                ...task,
                ...compiledTask,
                nxlScript: input.nxlScript,
            };
        }

        return task;
    }

    private executionTaskFromCompiled(compiled: DSLCompilationResult, rawScript?: string): ExecutionTask {
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
                dslCompiler: this.dslCompiler.descriptor.kind,
            },
            skillNames: compiled.spec.skills,
            actions: (compiled.spec.actions ?? []) as unknown as SkillBinding[],
            inlineSkills: [],
            nxlScript: rawScript,
        };
    }

    private resolveBackends(task: ExecutionTask): BackendSelection {
        return {
            memoryBackend: task.backendSelectors.memoryBackend ?? this.memoryBackend.descriptor.kind,
            compressionBackend: task.backendSelectors.compressionBackend ?? this.compressionBackend.descriptor.kind,
            consensusPolicy: task.backendSelectors.consensusPolicy ?? this.consensusPolicy.descriptor.kind,
            dslCompiler: task.backendSelectors.dslCompiler ?? this.dslCompiler.descriptor.kind,
        };
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
        activeSkills: SkillArtifact[]
    ): WorkerManifest[] {
        const workerIds = new Array(task.workers).fill(null).map((_, idx) => `coder-${idx + 1}`);
        const budgets = this.compressionBackend.allocateWorkerBudget(workerIds, plan);
        const sessionSkillIds = activeSkills.map(skill => skill.skillId);

        return workerIds.map((workerId, idx) => ({
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
            allowedTools: ['write_file', 'append_file', 'replace_text', 'run_command'],
            tokenBudget: budgets.get(workerId) ?? 500,
            verifyCommands: task.verifyCommands,
            checkpoints: ['before-read', 'before-mutate', 'before-verify'],
            actions: task.actions,
            inlineSkills: activeSkills,
        }));
    }

    private async runCoderWorker(
        runId: string,
        recorder: ArtifactRecorder,
        manifest: WorkerManifest
    ): Promise<RuntimeWorkerResult> {
        const session = new WorktreeSession(this.repoRoot, `${runId}-${manifest.workerId}`, 'coder', recorder);
        const start = Date.now();
        const learnings: string[] = [];
        const workerDir = recorder.workerDir(manifest.workerId);

        try {
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

            let verification: WorkerVerification | undefined;
            let verified = false;
            if (diff.trim() && manifest.verifyCommands.length > 0) {
                verification = await this.runVerifier(manifest, diff, recorder);
                verified = verification.passed;
            }

            const activeMutateSkills = manifest.inlineSkills.filter(skill => skill.riskClass === 'mutate');
            activeMutateSkills.forEach(skill => {
                this.sessionDNA?.recordSkillLearned(skill.name);
                this.skillRuntime.recordOutcome(skill.skillId, {
                    success: false,
                    verificationPassed: false,
                });
            });

            const confidence = verified ? 0.92 : (diff.trim() ? 0.65 : 0.35);
            return {
                workerId: manifest.workerId,
                role: manifest.role,
                taskId: runId,
                approach: manifest.strategy,
                diff,
                outcome: verified ? 'success' : (diff.trim() ? 'partial' : 'failed'),
                confidence,
                tokensUsed: Math.max(1, Math.round((Date.now() - start) / 100)),
                learnings,
                testsPassing: verification?.passed ? verification.commands.length : 0,
                verified,
                verification,
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

    private async runVerifier(manifest: WorkerManifest, diff: string, recorder: ArtifactRecorder): Promise<WorkerVerification> {
        const verifier = new WorktreeSession(this.repoRoot, `${manifest.workerId}-verify`, 'verifier', recorder);
        const records: CommandRecord[] = [];
        try {
            await verifier.create();

            const verifySkills = manifest.inlineSkills.filter(skill => skill.riskClass !== 'mutate');
            for (const skill of verifySkills) {
                this.skillRuntime.deploy(skill, `${manifest.workerId}-verify`, verifier.worktreeDir, 'before-verify');
            }

            await verifier.applyPatchContent(diff);

            for (const command of manifest.verifyCommands) {
                const record = await verifier.run(command, true);
                records.push(record);
            }

            const passed = records.every(record => record.exitCode === 0);
            manifest.inlineSkills
                .filter(skill => skill.riskClass !== 'mutate')
                .forEach(skill => {
                    this.skillRuntime.recordOutcome(skill.skillId, {
                        success: passed,
                        verificationPassed: passed,
                    });
                });

            return {
                passed,
                commands: records,
                summary: passed
                    ? `Verifier passed ${records.length} command(s).`
                    : `Verifier failed ${records.filter(record => record.exitCode !== 0).length} command(s).`,
            };
        } finally {
            await verifier.cleanup();
        }
    }

    private async applyDecision(
        recorder: ArtifactRecorder,
        task: ExecutionTask,
        decision: MergeDecision
    ): Promise<{ applied: boolean; rolledBack: boolean; summary: string }> {
        const candidateDiff = this.resolveCandidateDiff(decision);
        if (!candidateDiff.trim()) {
            return {
                applied: false,
                rolledBack: false,
                summary: `Execution finished with ${decision.action} but no applicable diff was produced.`,
            };
        }

        if (!this.consensusPolicy.approveRunLevelChange(
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

    private discoverTargetFiles(goal: string): FileRef[] {
        const files = scanFiles(this.repoRoot);
        const plan = this.compressionBackend.planFiles(taskLike(goal), files);
        return plan.files
            .filter(filePlan => filePlan.action !== 'skip')
            .slice(0, 8)
            .map(filePlan => filePlan.file);
    }
}

function taskLike(goal: string): string {
    return goal;
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
    return value.replace(/[^a-z0-9\-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'command';
}

function relativeTo(root: string, target: string): string {
    const rel = path.relative(root, target);
    return rel.startsWith('..') ? target : rel;
}

function quote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
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
