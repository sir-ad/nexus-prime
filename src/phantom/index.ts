/**
 * Phantom Workers — Parallel Git Worktree Agents
 *
 * Beyond sub-agents: each Phantom Worker gets an isolated git worktree,
 * works in parallel, and the Merge Oracle picks the best result.
 *
 * Pattern:
 *   GhostPass (read-only analysis)
 *     → N PhantomWorkers (parallel, git worktrees)
 *       → MergeOracle (Byzantine vote, synthesize best)
 *         → LiveNexus (self-improvement trigger)
 */

import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { randomUUID } from 'crypto';
import type { MemoryEngine } from '../engines/memory.js';
import { MergeOracle } from './merge-oracle.js';
export { MergeOracle };
import { entanglementEngine } from '../engines/index.js';
import {
    WorktreeDoctorError,
    doctorGitWorktrees,
    summarizeWorktreeHealth,
    toWorktreeRemediation,
} from '../engines/worktree-health.js';
import {
    TokenSupremacyEngine,
    type FileRef,
    type ReadingPlan
} from '../engines/token-supremacy.js';
import { podNetwork, type PodMessage } from '../engines/pod-network.js';

const exec = promisify(execCallback);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkerTask {
    id: string;
    goal: string;
    files: FileRef[];
    approach: string;
    tokenBudget: number;
    entangledPeers?: string[];
    context?: string;       // From Nexus memory (prior recall)
    readingPlan?: ReadingPlan;
}

export interface WorkerResult {
    workerId: string;
    taskId: string;
    approach: string;
    diff: string;
    outcome: 'success' | 'partial' | 'failed';
    confidence: number;   // 0-1
    tokensUsed: number;
    learnings: string[];  // Key insights to store in memory
    testsPassing?: number;
}

export interface GhostReport {
    taskId: string;
    riskAreas: string[];
    workerAssignments: WorkerTask[];
    totalEstimatedTokens: number;
    readingPlan: ReadingPlan;
}

export interface MergeDecision {
    action: 'apply' | 'synthesize' | 'reject';
    winner?: WorkerResult;
    synthesized?: string;  // Combined diff
    rationale: string;
    confidence: number;
    learnings: string[];   // To store in Nexus memory
    conflicts: string[];   // Overlapping hunks detected
    recommendedStrategy: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ghost Pass — Read-Only Pre-Flight Analysis
// ─────────────────────────────────────────────────────────────────────────────

export class GhostPass {
    private tokenEngine: TokenSupremacyEngine;
    private repoRoot: string;

    constructor(repoRoot?: string) {
        this.tokenEngine = new TokenSupremacyEngine();
        this.repoRoot = repoRoot ?? process.cwd();
    }

    /**
     * Analyze the codebase WITHOUT touching anything.
     * Returns a reading plan + worker assignments.
     */
    async analyze(goal: string, targetFiles: FileRef[], numWorkers: number = 3): Promise<GhostReport> {
        const taskId = randomUUID();

        // Generate token-efficient reading plan
        const readingPlan = this.tokenEngine.plan(goal, targetFiles);

        // Identify risk areas from goal keywords
        const riskAreas = this.detectRiskAreas(goal, targetFiles);

        // Generate different approach assignments
        const workerAssignments = this.generateApproaches(goal, targetFiles, readingPlan, taskId, numWorkers);

        return {
            taskId,
            riskAreas,
            workerAssignments,
            totalEstimatedTokens: readingPlan.totalEstimatedTokens,
            readingPlan
        };
    }

    private detectRiskAreas(goal: string, files: FileRef[]): string[] {
        const risks: string[] = [];
        const goalLower = goal.toLowerCase();

        if (goalLower.includes('auth') || goalLower.includes('security')) {
            risks.push('Security-sensitive area: validate all changes carefully');
        }
        if (goalLower.includes('database') || goalLower.includes('schema')) {
            risks.push('Schema change: ensure migration exists, check backward compat');
        }
        if (goalLower.includes('delete') || goalLower.includes('remove')) {
            risks.push('Destructive operation: verify no dependents before removing');
        }
        if (files.some(f => f.path.includes('package.json'))) {
            risks.push('Dependency change: run npm install after, check for version conflicts');
        }

        return risks;
    }

    private generateApproaches(
        goal: string,
        files: FileRef[],
        readingPlan: ReadingPlan,
        taskId: string,
        numWorkers: number
    ): WorkerTask[] {
        const allApproaches = ['minimal', 'standard', 'thorough', 'exploratory', 'aggressive', 'conservative', 'lateral'];
        const num = Math.min(Math.max(1, numWorkers), 7);
        const approaches = allApproaches.slice(0, num);
        const budgetPerWorker = Math.floor(readingPlan.totalEstimatedTokens * 1.5 / approaches.length);

        return approaches.map((approach, i) => ({
            id: `${taskId}-worker-${i}`,
            goal,
            files,
            approach,
            tokenBudget: budgetPerWorker,
            readingPlan
        }));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phantom Worker — Isolated Git Worktree
// ─────────────────────────────────────────────────────────────────────────────

export class PhantomWorker {
    private workerId: string;
    private repoRoot: string;
    private worktreeDir: string;

    constructor(repoRoot?: string) {
        this.workerId = `phantom-${randomUUID().slice(0, 8)}`;
        this.repoRoot = repoRoot ?? process.cwd();
        this.worktreeDir = path.join(os.tmpdir(), 'nexus-phantom', this.workerId);
    }

    get id(): string { return this.workerId; }

    /** Sync a finding to the POD Network mid-execution */
    broadcast(content: string, confidence: number = 0.8, tags: string[] = []): PodMessage {
        return podNetwork.publish(this.workerId, content, confidence, [...tags, `#worker-${this.workerId}`]);
    }

    /** Receive relevant findings from other workers from the POD */
    receive(tags: string[] = []): PodMessage[] {
        return podNetwork.recall(tags);
    }

    /**
     * Spawn this worker in an isolated git worktree.
     * The executor function receives the worktree path and operates within it.
     */
    async spawn(
        task: WorkerTask,
        executor: (worktreeDir: string, task: WorkerTask, worker: PhantomWorker) => Promise<{ learnings: string[]; confidence: number }>
    ): Promise<WorkerResult> {
        const startTime = Date.now();

        try {
            if ((task.entangledPeers?.length ?? 0) > 0) {
                const state = entanglementEngine.entangle([this.workerId, ...task.entangledPeers!]);
                entanglementEngine.measure(state.id, this.workerId);
            }

            // Create isolated worktree
            await this.createWorktree();

            // Execute the task in isolation
            // Pass the worker instance itself so the executor can call .broadcast()
            const { learnings, confidence } = await executor(this.worktreeDir, task, this);

            // Capture the diff (what changed vs main)
            const diff = await this.captureDiff();

            return {
                workerId: this.workerId,
                taskId: task.id,
                approach: task.approach,
                diff,
                outcome: diff.trim().length > 0 ? 'success' : 'partial',
                confidence,
                tokensUsed: Math.round((Date.now() - startTime) / 100), // approx
                learnings
            };
        } catch (err) {
            return {
                workerId: this.workerId,
                taskId: task.id,
                approach: task.approach,
                diff: '',
                outcome: 'failed',
                confidence: 0,
                tokensUsed: 0,
                learnings: [`Worker ${this.workerId} failed: ${String(err)}`]
            };
        } finally {
            await this.cleanup();
        }
    }

    private async createWorktree(): Promise<void> {
        fs.mkdirSync(path.dirname(this.worktreeDir), { recursive: true });

        await doctorGitWorktrees(this.repoRoot);

        // Detached worktrees avoid ref-lock conflicts and are sufficient for diff-only execution.
        try {
            await exec(
                `git worktree add --detach "${this.worktreeDir}"`,
                { cwd: this.repoRoot }
            );
        } catch (error: any) {
            const health = await doctorGitWorktrees(this.repoRoot);
            throw new WorktreeDoctorError(
                `Unable to prepare phantom worker worktree. ${summarizeWorktreeHealth(health)}`,
                health,
                toWorktreeRemediation(error, this.worktreeDir),
            );
        }
    }

    private async captureDiff(): Promise<string> {
        try {
            await exec('git add -A', { cwd: this.worktreeDir });
            const { stdout } = await exec(
                `git diff --binary --cached HEAD`,
                { cwd: this.worktreeDir }
            );
            return stdout;
        } catch {
            return '';
        }
    }

    private async cleanup(): Promise<void> {
        try {
            await exec(
                `git worktree remove "${this.worktreeDir}" --force`,
                { cwd: this.repoRoot }
            );
        } catch {
            // Best effort cleanup
        }
    }

    /** List all active phantom worktrees (for test/debug verification) */
    static async getWorktreeList(repoRoot: string = process.cwd()): Promise<string[]> {
        try {
            const { stdout } = await exec('git worktree list --porcelain', { cwd: repoRoot });
            return stdout
                .split('\n')
                .filter(line => line.startsWith('worktree '))
                .map(line => line.replace('worktree ', '').trim())
                .filter(p => p.includes('nexus-phantom') || p.includes('nexus-prime-worktrees'));
        } catch {
            return [];
        }
    }

    /** Force-remove any leftover phantom worktrees (emergency cleanup) */
    static async purgeOrphanedWorktrees(repoRoot: string = process.cwd()): Promise<number> {
        const list = await PhantomWorker.getWorktreeList(repoRoot);
        let removed = 0;
        for (const dir of list) {
            try {
                await exec(`git worktree remove "${dir}" --force`, { cwd: repoRoot });
                removed++;
            } catch { /* skip */ }
        }
        return removed;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PhantomOrchestrator — High-level entry point
// ─────────────────────────────────────────────────────────────────────────────

export class PhantomOrchestrator {
    private ghost: GhostPass;
    private oracle: MergeOracle;
    private repoRoot: string;

    constructor(memory: MemoryEngine, repoRoot?: string) {
        this.repoRoot = repoRoot ?? process.cwd();
        this.ghost = new GhostPass(this.repoRoot);
        this.oracle = new MergeOracle(memory);
    }

    /**
     * Full phantom run: Ghost → Workers → Oracle → Decision
     *
     * @param goal      What to accomplish
     * @param files     Files relevant to the task
     * @param executor  Function that executes in a worker's isolated worktree
     * @param nWorkers  Number of parallel workers (default 3)
     */
    async run(
        goal: string,
        files: FileRef[],
        executor: (worktreeDir: string, task: WorkerTask, worker: PhantomWorker) => Promise<{ learnings: string[]; confidence: number }>,
        nWorkers: number = 2
    ): Promise<{ report: GhostReport; decision: MergeDecision }> {
        // Phase 1: Ghost Pass
        const report = await this.ghost.analyze(goal, files, nWorkers);

        // Phase 2: Parallel Phantom Workers
        const tasks = report.workerAssignments.slice(0, nWorkers);
        const workerPromises = tasks.map(task => {
            const worker = new PhantomWorker(this.repoRoot);
            return worker.spawn(task, executor);
        });

        const results = await Promise.allSettled(workerPromises);
        const workerResults = results
            .filter((r): r is PromiseFulfilledResult<WorkerResult> => r.status === 'fulfilled')
            .map(r => r.value);

        // Phase 3: Merge Oracle
        const decision = await this.oracle.merge(workerResults);

        return { report, decision };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Nexus — Self-Rewriting Trigger
// ─────────────────────────────────────────────────────────────────────────────

export interface HotFunction {
    name: string;
    sourceFile: string;
    callCount: number;
    failureRate: number;
    avgTokensWasted: number;
}

export class LiveNexus {
    private hotFunctions: Map<string, HotFunction> = new Map();
    private memory: MemoryEngine;
    private orchestrator: PhantomOrchestrator;
    private repoRoot: string;

    constructor(memory: MemoryEngine, repoRoot?: string) {
        this.memory = memory;
        this.repoRoot = repoRoot ?? process.cwd();
        this.orchestrator = new PhantomOrchestrator(memory, repoRoot);
    }

    /** Record a function call outcome for monitoring */
    record(fnName: string, sourceFile: string, success: boolean, tokensWasted: number = 0): void {
        const existing = this.hotFunctions.get(fnName) ?? {
            name: fnName,
            sourceFile,
            callCount: 0,
            failureRate: 0,
            avgTokensWasted: 0
        };

        const newCallCount = existing.callCount + 1;
        const newFailureRate = (existing.failureRate * existing.callCount + (success ? 0 : 1)) / newCallCount;
        const newTokensWasted = (existing.avgTokensWasted * existing.callCount + tokensWasted) / newCallCount;

        this.hotFunctions.set(fnName, {
            ...existing,
            callCount: newCallCount,
            failureRate: newFailureRate,
            avgTokensWasted: newTokensWasted
        });
    }

    /** Get functions that need improvement */
    getCandidatesForEvolution(): HotFunction[] {
        return [...this.hotFunctions.values()].filter(
            fn => fn.failureRate > 0.15 || fn.avgTokensWasted > 2000
        );
    }

    /** Check if evolution should trigger, store report to memory */
    async checkAndEvolve(): Promise<void> {
        const candidates = this.getCandidatesForEvolution();

        for (const fn of candidates) {
            const summary = `Evolution candidate: ${fn.name} in ${fn.sourceFile} — ` +
                `failure rate: ${(fn.failureRate * 100).toFixed(1)}%, ` +
                `avg tokens wasted: ${fn.avgTokensWasted.toFixed(0)}`;

            this.memory.store(summary, 0.85, ['#evolution-candidate', '#live-nexus']);
        }

        if (candidates.length > 0) {
            const report = candidates.map(c =>
                `${c.name}: ${(c.failureRate * 100).toFixed(1)}% failure, ${c.avgTokensWasted.toFixed(0)} tokens wasted`
            ).join('\n');

            this.memory.store(
                `Live Nexus evolution report:\n${report}`,
                0.9,
                ['#live-nexus', '#evolution']
            );
        }
    }
}

// All classes exported inline above via `export class`.
export {
    SubAgentRuntime,
    createSubAgentRuntime,
    summarizeExecution,
    executionStats,
} from './runtime.js';
export type {
    BackendSelection,
    CommandRecord,
    ExecutionMode,
    ExecutionRun,
    ExecutionState,
    ExecutionTask,
    PlannerResult,
    PromotionDecision,
    RuntimeWorkerResult,
    SkillPolicy,
    PromotionPolicy,
    DerivationPolicy,
    WorkerManifest,
    WorkerRole,
    WorkerSkillOverlay,
    WorkerVerification,
} from './runtime.js';
