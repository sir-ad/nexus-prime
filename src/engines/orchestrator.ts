/**
 * Autonomy Orchestrator
 *
 * Mandatory control plane for high-level Nexus Prime execution.
 * Raw prompts flow through this layer before the runtime executes work.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { MemoryEngine } from './memory.js';
import { nexusEventBus } from './event-bus.js';
import { nxl, type AgentArchetype } from './nxl-interpreter.js';
import { TokenSupremacyEngine, type FileRef } from './token-supremacy.js';
import { resolveNexusStateDir } from './runtime-registry.js';
import type {
  RuntimeOrchestrationSnapshot,
  RuntimePrimaryClientSnapshot,
  RuntimeTokenSummarySnapshot,
} from './runtime-registry.js';
import { SessionDNAManager } from './session-dna.js';
import type { ClientRecord, ClientRegistry } from './client-registry.js';
import {
  DEFAULT_REQUIRED_SEQUENCE,
  InstructionGateway,
  createExecutionLedger,
  markExecutionLedgerStep,
  type ExecutionLedger,
  type GovernanceSnapshot,
  type InstructionPacket,
} from './instruction-gateway.js';
import {
  createSubAgentRuntime,
  type ExecutionRun,
  type ExecutionTask,
  type SubAgentRuntime,
} from '../phantom/index.js';

export type AgentType = 'researcher' | 'coder' | 'planner' | 'executor' | 'reviewer' | 'architect' | 'ux-validator';

export interface Agent {
  id: string;
  type: AgentType | string;
  task: string;
  state: 'pending' | 'running' | 'complete' | 'failed';
  result?: string;
  archetype?: AgentArchetype;
}

export interface Task {
  id: string;
  description: string;
  complexity: number;
  subtasks: string[];
}

export interface AutonomyIntent {
  taskType: 'bugfix' | 'feature' | 'release' | 'review' | 'research' | 'refactor' | 'ops';
  riskClass: 'low' | 'medium' | 'high';
  complexity: number;
}

export interface SessionAutonomyState {
  runtimeId: string;
  sessionId: string;
  startedAt: number;
  updatedAt: number;
  lastPrompt: string;
  objectiveHistory: string[];
  phases: string[];
  mode: RuntimeOrchestrationSnapshot['mode'];
  repeatedFailures: number;
  continuationDepth: number;
  intent: AutonomyIntent;
  selectedCrew?: string;
  selectedSpecialists: string[];
  selectedSkills: string[];
  selectedWorkflows: string[];
  selectedHooks: string[];
  selectedAutomations: string[];
  lastMemoryMatches: string[];
  latestSessionDNA?: {
    sessionId: string;
    timestamp: number;
    handoverScore: number;
  };
  lastRunId?: string;
  primaryClient?: RuntimePrimaryClientSnapshot;
  tokenSummary?: RuntimeTokenSummarySnapshot;
}

export interface SessionBootstrapResult {
  client?: RuntimePrimaryClientSnapshot;
  memoryRecall: {
    count: number;
    matches: string[];
  };
  memoryStats: ReturnType<MemoryEngine['getStats']>;
  recommendedNextStep: 'nexus_orchestrate' | 'nexus_plan_execution';
  recommendedExecutionMode: RuntimeOrchestrationSnapshot['mode'];
  shortlist: {
    crews: string[];
    specialists: string[];
    skills: string[];
    workflows: string[];
    hooks: string[];
    automations: string[];
  };
  tokenOptimization: {
    required: boolean;
    reason: string;
    candidateFiles: string[];
  };
  reviewGates: string[];
}

interface CatalogItem {
  id: string;
  name: string;
  body: string;
}

interface OrchestratorOptions {
  memory?: MemoryEngine;
  runtime?: SubAgentRuntime;
  clientRegistry?: ClientRegistry;
  sessionDNA?: SessionDNAManager;
  repoRoot?: string;
}

const MAX_AUTONOMY_HISTORY = 24;
const MAX_DISCOVERED_FILES = 32;
const DISCOVERY_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml']);
const DISCOVERY_IGNORES = new Set(['.git', 'node_modules', 'dist', 'coverage', '.next', '.playwright-cli', 'tmp']);

export class OrchestratorEngine {
  private agents: Map<string, Agent> = new Map();
  private memory: MemoryEngine;
  private agentCounter = 0;
  private runtime: SubAgentRuntime;
  private lastRun: ExecutionRun | null = null;
  private clientRegistry?: ClientRegistry;
  private sessionDNA?: SessionDNAManager;
  private repoRoot: string;
  private tokenEngine: TokenSupremacyEngine;
  private instructionGateway: InstructionGateway;
  private sessionsDir: string;
  private sessionState: SessionAutonomyState;

  constructor(options: OrchestratorOptions = {}) {
    this.memory = options.memory || new MemoryEngine();
    this.runtime = options.runtime || createSubAgentRuntime({
      repoRoot: options.repoRoot ?? process.cwd(),
      memory: this.memory,
    });
    this.clientRegistry = options.clientRegistry;
    this.sessionDNA = options.sessionDNA;
    this.repoRoot = options.repoRoot ?? process.cwd();
    this.tokenEngine = new TokenSupremacyEngine();
    this.instructionGateway = new InstructionGateway(this.repoRoot);
    this.sessionsDir = path.join(resolveNexusStateDir(), 'autonomy-sessions');
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    this.sessionState = this.loadSessionState();
  }

  /**
   * Induces a specialized army of agents based on the prompt.
   * This remains a planning signal for runtime execution, not a direct executor.
   */
  public async induce(task: string): Promise<Agent[]> {
    const archetypes = nxl.induceArmy(task);
    const inductedAgents: Agent[] = [];

    for (const arch of archetypes) {
      const id = `agent_${++this.agentCounter}_${arch.name.toLowerCase().replace(/\s+/g, '_')}`;
      const agent: Agent = {
        id,
        type: arch.role,
        task,
        state: 'pending',
        archetype: arch,
      };
      this.agents.set(id, agent);
      inductedAgents.push(agent);
    }

    nexusEventBus.emit('nexusnet.sync', { newItemsCount: inductedAgents.length });
    return inductedAgents;
  }

  public decomposeTask(task: string): string[] {
    const normalized = task
      .split(/\n+/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join(' ');

    const subtasks = normalized
      .split(/,| then | and then | after that | followed by | also /i)
      .map((segment) => segment.trim())
      .filter(Boolean);

    return subtasks.length > 0 ? subtasks : [task];
  }

  public async bootstrapSession(task: string, options: Partial<ExecutionTask> = {}): Promise<SessionBootstrapResult> {
    const intent = this.classifyIntent(task);
    const phases = this.decomposeTask(task);
    const primaryClient = this.resolvePrimaryClient();
    const latestDNA = SessionDNAManager.loadLatest();
    const memoryMatches = await this.memory.recall(task, 8);
    const memoryStats = this.memory.getStats();
    const planner = await this.runtime.planExecution({
      goal: task,
      files: options.files,
      skillNames: options.skillNames,
      workflowSelectors: options.workflowSelectors,
      crewSelectors: options.crewSelectors,
      specialistSelectors: options.specialistSelectors,
      workers: options.workers,
      optimizationProfile: options.optimizationProfile,
    });
    const candidateFiles = options.files?.length
      ? options.files
      : this.discoverCandidateFiles(task);
    const fileRefs = candidateFiles.map((filePath) => this.toFileRef(filePath)).filter((file): file is FileRef => Boolean(file));
    const tokenOptimizationRequired = fileRefs.length >= 3;
    const selectedSkills = options.skillNames?.length
      ? [...options.skillNames]
      : dedupeStrings([...planner.selectedSkills, ...this.pickCatalogNames(task, intent, this.runtime.listSkills().map((skill) => ({
          id: skill.skillId,
          name: skill.name,
          body: `${skill.name}\n${skill.instructions}\n${skill.provenance}`,
        })), 4)]);
    const selectedWorkflows = options.workflowSelectors?.length
      ? [...options.workflowSelectors]
      : dedupeStrings([...planner.selectedWorkflows, ...this.pickCatalogNames(task, intent, this.runtime.listWorkflows().map((workflow) => ({
          id: workflow.workflowId,
          name: workflow.name,
          body: `${workflow.name}\n${workflow.description}\n${workflow.domain}`,
        })), 3)]);
    const selectedHooks = options.hookSelectors?.length
      ? [...options.hookSelectors]
      : this.pickCatalogNames(task, intent, this.runtime.listHooks().map((hook) => ({
          id: hook.hookId,
          name: hook.name,
          body: `${hook.name}\n${hook.description}\n${hook.trigger}`,
        })), intent.riskClass === 'high' ? 2 : 1);
    const selectedAutomations = options.automationSelectors?.length
      ? [...options.automationSelectors]
      : this.pickCatalogNames(task, intent, this.runtime.listAutomations().map((automation) => ({
          id: automation.automationId,
          name: automation.name,
          body: `${automation.name}\n${automation.description}\n${automation.triggerMode}\n${automation.eventTrigger ?? ''}`,
        })), intent.taskType === 'release' || this.sessionState.repeatedFailures > 0 ? 2 : 1);
    const selectedSpecialists = options.specialistSelectors?.length
      ? [...options.specialistSelectors]
      : planner.selectedSpecialists.map((specialist) => specialist.specialistId);
    const selectedCrew = options.crewSelectors?.length
      ? options.crewSelectors[0]
      : planner.selectedCrew?.crewId;
    const workerCount = this.decideWorkers(options.workers, planner.swarmDecision.workers, phases.length, intent, this.sessionState.repeatedFailures);
    const mode = this.determineMode(intent, phases.length, workerCount);

    this.sessionState = {
      ...this.sessionState,
      updatedAt: Date.now(),
      lastPrompt: task,
      objectiveHistory: dedupeStrings([task, ...this.sessionState.objectiveHistory]).slice(0, MAX_AUTONOMY_HISTORY),
      phases,
      mode,
      intent,
      selectedCrew,
      selectedSpecialists,
      selectedSkills,
      selectedWorkflows,
      selectedHooks,
      selectedAutomations,
      lastMemoryMatches: memoryMatches.slice(0, 6),
      latestSessionDNA: latestDNA
        ? {
            sessionId: latestDNA.sessionId,
            timestamp: latestDNA.timestamp,
            handoverScore: latestDNA.handoverScore,
          }
        : this.sessionState.latestSessionDNA,
      primaryClient,
    };
    this.persistSessionState();
    this.runtime.recordPrimaryClient(primaryClient, this.listDetectedClients());
    this.runtime.recordOrchestrationSnapshot(this.toRuntimeOrchestrationSnapshot(this.sessionState));
    this.runtime.recordClientToolCall('nexus_session_bootstrap', {
      bootstrapCalled: true,
      plannerCalled: true,
      tokenOptimizationApplied: tokenOptimizationRequired,
    });

    return {
      client: primaryClient,
      memoryRecall: {
        count: memoryMatches.length,
        matches: memoryMatches.slice(0, 6),
      },
      memoryStats,
      recommendedNextStep: 'nexus_orchestrate',
      recommendedExecutionMode: mode,
      shortlist: {
        crews: selectedCrew ? [selectedCrew] : [],
        specialists: selectedSpecialists,
        skills: selectedSkills,
        workflows: selectedWorkflows,
        hooks: selectedHooks,
        automations: selectedAutomations,
      },
      tokenOptimization: {
        required: tokenOptimizationRequired,
        reason: tokenOptimizationRequired ? 'candidate-files-above-threshold' : 'candidate-files-below-threshold',
        candidateFiles,
      },
      reviewGates: planner.reviewGates.map((gate) => `${gate.gate}:${gate.status}`),
    };
  }

  public async orchestrate(task: string, options: Partial<ExecutionTask> = {}): Promise<ExecutionRun> {
    const army = await this.induce(task);
    const intent = this.classifyIntent(task);
    const phases = this.decomposeTask(task);
    const primaryClient = this.resolvePrimaryClient();
    this.runtime.recordClientToolCall('nexus_orchestrate', {
      orchestrateCalled: true,
      plannerCalled: true,
    });
    const ledger = createExecutionLedger({
      sessionId: this.sessionState.sessionId,
      task,
      executionMode: 'autonomous',
      clientId: primaryClient?.clientId,
      clientFamily: primaryClient?.clientFamily,
    });
    markExecutionLedgerStep(ledger, 'identify-client-session', 'completed', {
      summary: primaryClient?.displayName ?? 'No explicit client detected',
      details: {
        clientId: primaryClient?.clientId ?? 'unknown',
        source: primaryClient?.source ?? 'env',
      },
    });
    const latestDNA = SessionDNAManager.loadLatest();
    const memoryMatches = await this.memory.recall(task, 8);
    markExecutionLedgerStep(ledger, 'recall-memory', 'completed', {
      summary: `Recalled ${memoryMatches.length} memory match(es).`,
      details: { matches: memoryMatches.slice(0, 4) },
    });
    nexusEventBus.emit('memory.recall', { query: task, count: memoryMatches.length });
    const memoryStats = this.memory.getStats();
    markExecutionLedgerStep(ledger, 'memory-stats', 'completed', {
      summary: `Loaded memory stats (${memoryStats.cortex} cortex / ${memoryStats.hippocampus} hippocampus).`,
      details: {
        prefrontal: memoryStats.prefrontal,
        hippocampus: memoryStats.hippocampus,
        cortex: memoryStats.cortex,
        totalLinks: memoryStats.totalLinks,
      },
    });

    const planner = await this.runtime.planExecution({
      goal: task,
      files: options.files,
      skillNames: options.skillNames,
      workflowSelectors: options.workflowSelectors,
      crewSelectors: options.crewSelectors,
      specialistSelectors: options.specialistSelectors,
      workers: options.workers,
      optimizationProfile: options.optimizationProfile,
    });
    markExecutionLedgerStep(ledger, 'planner-selection', 'completed', {
      summary: `Planner selected ${planner.selectedCrew?.name ?? 'baseline'}.`,
      details: {
        crew: planner.selectedCrew?.crewId ?? null,
        specialists: planner.selectedSpecialists.map((specialist) => specialist.specialistId),
        workflows: planner.selectedWorkflows,
        skills: planner.selectedSkills,
      },
    });

    const candidateFiles = options.files?.length
      ? options.files
      : this.discoverCandidateFiles(task);
    markExecutionLedgerStep(ledger, 'candidate-file-discovery', 'completed', {
      summary: `${candidateFiles.length} candidate file(s) discovered.`,
      details: { files: candidateFiles.slice(0, 24) },
    });
    const fileRefs = candidateFiles.map((filePath) => this.toFileRef(filePath)).filter((file): file is FileRef => Boolean(file));
    const tokenPlan = fileRefs.length >= 3 ? this.tokenEngine.plan(task, fileRefs) : undefined;
    const plannedFiles = tokenPlan
      ? tokenPlan.files.filter((entry) => entry.action !== 'skip').map((entry) => entry.file.path)
      : candidateFiles;

    const selectedSkills = options.skillNames?.length
      ? [...options.skillNames]
      : dedupeStrings([...planner.selectedSkills, ...this.pickCatalogNames(task, intent, this.runtime.listSkills().map((skill) => ({
          id: skill.skillId,
          name: skill.name,
          body: `${skill.name}\n${skill.instructions}\n${skill.provenance}`,
        })), 4)]);
    const selectedWorkflows = options.workflowSelectors?.length
      ? [...options.workflowSelectors]
      : dedupeStrings([...planner.selectedWorkflows, ...this.pickCatalogNames(task, intent, this.runtime.listWorkflows().map((workflow) => ({
          id: workflow.workflowId,
          name: workflow.name,
          body: `${workflow.name}\n${workflow.description}\n${workflow.domain}`,
        })), 3)]);
    const selectedHooks = options.hookSelectors?.length
      ? [...options.hookSelectors]
      : this.pickCatalogNames(task, intent, this.runtime.listHooks().map((hook) => ({
          id: hook.hookId,
          name: hook.name,
          body: `${hook.name}\n${hook.description}\n${hook.trigger}`,
        })), intent.riskClass === 'high' ? 2 : 1);
    const selectedAutomations = options.automationSelectors?.length
      ? [...options.automationSelectors]
      : this.pickCatalogNames(task, intent, this.runtime.listAutomations().map((automation) => ({
          id: automation.automationId,
          name: automation.name,
          body: `${automation.name}\n${automation.description}\n${automation.triggerMode}\n${automation.eventTrigger ?? ''}`,
        })), intent.taskType === 'release' || this.sessionState.repeatedFailures > 0 ? 2 : 1);
    const selectedSpecialists = options.specialistSelectors?.length
      ? [...options.specialistSelectors]
      : planner.selectedSpecialists.map((specialist) => specialist.specialistId);
    const selectedCrew = options.crewSelectors?.length
      ? options.crewSelectors[0]
      : planner.selectedCrew?.crewId;
    markExecutionLedgerStep(ledger, 'catalog-shortlist', 'completed', {
      summary: 'Built orchestration shortlist across catalogs.',
      details: {
        selectedCrew,
        specialists: selectedSpecialists,
        skills: selectedSkills,
        workflows: selectedWorkflows,
        hooks: selectedHooks,
        automations: selectedAutomations,
      },
    });
    if (tokenPlan) {
      markExecutionLedgerStep(ledger, 'token-optimization', 'completed', {
        summary: `Optimizer routed ${tokenPlan.files.length} files with ${tokenPlan.savings} estimated token savings.`,
        details: {
          inputTokens: tokenPlan.totalEstimatedTokens + tokenPlan.savings,
          outputTokens: tokenPlan.totalEstimatedTokens,
          selectedFiles: plannedFiles,
        },
      });
    } else {
      markExecutionLedgerStep(ledger, 'token-optimization', 'skipped', {
        reason: fileRefs.length < 3 ? 'candidate-files-below-threshold' : 'no-file-refs',
        summary: 'Token optimization only auto-runs in the orchestrator when 3+ files are in play.',
      });
    }
    const workerCount = this.decideWorkers(options.workers, planner.swarmDecision.workers, phases.length, intent, this.sessionState.repeatedFailures);
    const mode = this.determineMode(intent, phases.length, workerCount);
    const governance = this.runtime.previewGovernancePreflight({
      goal: task,
      files: plannedFiles,
      tokenCount: 2500 + plannedFiles.length * 300,
      isDestructive: false,
    });
    markExecutionLedgerStep(ledger, 'governance-preflight', governance.passed ? 'completed' : 'blocked', {
      summary: `Governance preflight score ${governance.score}.`,
      details: {
        passed: governance.passed,
        violations: governance.violations.map((violation) => violation.id),
      },
    });

    const sessionState: SessionAutonomyState = {
      ...this.sessionState,
      updatedAt: Date.now(),
      lastPrompt: task,
      objectiveHistory: dedupeStrings([task, ...this.sessionState.objectiveHistory]).slice(0, MAX_AUTONOMY_HISTORY),
      phases,
      mode,
      intent,
      selectedCrew,
      selectedSpecialists,
      selectedSkills,
      selectedWorkflows,
      selectedHooks,
      selectedAutomations,
      lastMemoryMatches: memoryMatches.slice(0, 6),
      latestSessionDNA: latestDNA
        ? {
            sessionId: latestDNA.sessionId,
            timestamp: latestDNA.timestamp,
            handoverScore: latestDNA.handoverScore,
          }
        : this.sessionState.latestSessionDNA,
      primaryClient,
      continuationDepth: Math.max(this.sessionState.continuationDepth, options.continuationDepth ?? 0),
    };

    this.sessionState = sessionState;
    this.persistSessionState();
    this.runtime.recordPrimaryClient(primaryClient, this.listDetectedClients());
    this.runtime.recordOrchestrationSnapshot(this.toRuntimeOrchestrationSnapshot(sessionState));

    if (tokenPlan) {
      nexusEventBus.emit('tokens.optimized', {
        savings: tokenPlan.savings,
        pct: tokenPlan.totalEstimatedTokens + tokenPlan.savings > 0
          ? Math.round((tokenPlan.savings / (tokenPlan.totalEstimatedTokens + tokenPlan.savings)) * 100)
          : 0,
        files: tokenPlan.files.length,
        inputTokens: tokenPlan.totalEstimatedTokens + tokenPlan.savings,
        outputTokens: tokenPlan.totalEstimatedTokens,
        compressionRatio: tokenPlan.totalEstimatedTokens > 0
          ? (tokenPlan.totalEstimatedTokens + tokenPlan.savings) / tokenPlan.totalEstimatedTokens
          : 0,
        sessionId: sessionState.sessionId,
        phase: 'orchestrator',
        subsystem: 'token-planning',
      });
    }

    const instructionPacket = this.instructionGateway.compile({
      runtimeId: this.runtime.getRuntimeId(),
      sessionId: sessionState.sessionId,
      goal: task,
      executionMode: 'autonomous',
      objectiveHistory: sessionState.objectiveHistory,
      phases,
      requiredSequence: DEFAULT_REQUIRED_SEQUENCE,
      client: primaryClient,
      selectedCrew: planner.selectedCrew,
      selectedSpecialists: planner.selectedSpecialists,
      selectedSkills: this.runtime.listSkills().filter((skill) => selectedSkills.includes(skill.name)),
      selectedWorkflows: this.runtime.listWorkflows().filter((workflow) => selectedWorkflows.includes(workflow.name)),
      selectedHooks: this.runtime.listHooks().filter((hook) => selectedHooks.includes(hook.name)),
      selectedAutomations: this.runtime.listAutomations().filter((automation) => selectedAutomations.includes(automation.name)),
      catalogShortlist: {
        crews: selectedCrew ? [selectedCrew] : [],
        specialists: selectedSpecialists,
        skills: selectedSkills,
        workflows: selectedWorkflows,
        hooks: selectedHooks,
        automations: selectedAutomations,
      },
      governance: this.toGovernanceSnapshot(governance),
      federation: this.runtime.getUsageSnapshot().federation,
      tokenPolicy: {
        applied: Boolean(tokenPlan),
        reason: tokenPlan ? 'orchestrator-selected' : (fileRefs.length < 3 ? 'candidate-files-below-threshold' : 'no-file-refs'),
        candidateFiles,
        selectedFiles: plannedFiles,
        estimatedSavings: Number(tokenPlan?.savings ?? 0),
        estimatedCompressionPct: tokenPlan && tokenPlan.totalEstimatedTokens + tokenPlan.savings > 0
          ? Math.round((tokenPlan.savings / (tokenPlan.totalEstimatedTokens + tokenPlan.savings)) * 100)
          : 0,
      },
      memoryMatches,
      memoryStats,
      manualOverrides: [],
    });
    this.instructionGateway.persist(instructionPacket, this.repoRoot);
    markExecutionLedgerStep(ledger, 'compile-instruction-packet', 'completed', {
      summary: `Compiled instruction packet ${instructionPacket.packetHash}.`,
      details: {
        estimatedTokens: instructionPacket.estimatedTokens,
      },
    });
    ledger.packetHash = instructionPacket.packetHash;
    this.runtime.recordInstructionPacket(instructionPacket, {
      executionMode: 'autonomous',
      plannerApplied: ledger.plannerApplied,
      tokenOptimizationApplied: ledger.tokenOptimizationApplied,
    });
    this.runtime.recordExecutionLedger(ledger, 'autonomous');

    army.forEach((agent) => {
      agent.state = 'running';
    });

    const run = await this.runtime.run({
      ...options,
      goal: task,
      files: options.files?.length ? options.files : plannedFiles,
      workers: workerCount,
      skillNames: selectedSkills,
      workflowSelectors: selectedWorkflows,
      hookSelectors: selectedHooks,
      automationSelectors: selectedAutomations,
      crewSelectors: options.crewSelectors?.length ? options.crewSelectors : selectedCrew ? [selectedCrew] : [],
      specialistSelectors: options.specialistSelectors?.length ? options.specialistSelectors : selectedSpecialists,
      optimizationProfile: options.optimizationProfile ?? planner.optimizationProfile,
      executionMode: 'autonomous',
      manualOverrides: [],
      instructionPacket,
      executionLedger: ledger,
    });
    this.lastRun = run;

    army.forEach((agent) => {
      agent.state = run.state === 'failed' ? 'failed' : 'complete';
      agent.result = run.result;
    });

    this.sessionState = {
      ...sessionState,
      updatedAt: Date.now(),
      repeatedFailures: run.state === 'merged' ? 0 : Math.min(sessionState.repeatedFailures + 1, 8),
      continuationDepth: Math.max(sessionState.continuationDepth, run.continuationChildren.length > 0 ? 1 : 0),
      lastRunId: run.runId,
      tokenSummary: this.runtime.getTokenTelemetrySummary(),
      selectedCrew: run.plannerState?.selectedCrew?.crewId ?? sessionState.selectedCrew,
      selectedSpecialists: run.plannerState?.selectedSpecialists?.map((specialist) => specialist.specialistId) ?? sessionState.selectedSpecialists,
      selectedSkills: run.activeSkills.map((skill) => skill.name),
      selectedWorkflows: run.activeWorkflows.map((workflow) => workflow.name),
      selectedHooks: run.activeHooks.map((hook) => hook.name),
      selectedAutomations: run.activeAutomations.map((automation) => automation.name),
    };
    this.persistSessionState();
    this.runtime.recordOrchestrationSnapshot(this.toRuntimeOrchestrationSnapshot(this.sessionState));
    this.runtime.recordPrimaryClient(primaryClient, this.listDetectedClients());
    markExecutionLedgerStep(ledger, 'runtime-execution', run.state === 'failed' ? 'failed' : 'completed', {
      summary: run.result,
      details: {
        runId: run.runId,
        state: run.state,
        verifiedWorkers: run.workerResults.filter((worker) => worker.verified).length,
      },
    });
    await this.runtime.storeMemoryAndDispatch(
      `Orchestrated run ${run.runId}: ${task} -> ${run.state} (${run.result})`,
      run.state === 'merged' ? 0.88 : 0.72,
      ['#orchestrator', '#session', `#${run.state}`],
    );
    markExecutionLedgerStep(ledger, 'structured-learning', 'completed', {
      summary: 'Stored orchestrator session learning and refreshed runtime metadata.',
      details: { runId: run.runId },
    });
    run.executionLedger = ledger;
    run.instructionPacket = instructionPacket;
    this.runtime.recordExecutionLedger(ledger, 'autonomous');
    this.runtime.recordInstructionPacket(instructionPacket, {
      executionMode: 'autonomous',
      plannerApplied: ledger.plannerApplied,
      tokenOptimizationApplied: ledger.tokenOptimizationApplied,
    });
    this.runtime.updateExecutionMetadata(run.runId, {
      instructionPacket,
      executionLedger: ledger,
    });

    return run;
  }

  /**
   * Backward-compatible alias for the old high-level entrypoint.
   */
  public async executeSwarm(task: string, options?: Partial<ExecutionTask>): Promise<ExecutionRun> {
    return this.orchestrate(task, options);
  }

  public getAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  public getLastRun(): ExecutionRun | null {
    return this.lastRun;
  }

  public getSessionState(): SessionAutonomyState {
    return this.sessionState;
  }

  public async plan(task: string, options?: Partial<ExecutionTask>) {
    return this.runtime.planExecution({
      goal: task,
      files: options?.files,
      skillNames: options?.skillNames,
      workflowSelectors: options?.workflowSelectors,
      crewSelectors: options?.crewSelectors,
      specialistSelectors: options?.specialistSelectors,
      optimizationProfile: options?.optimizationProfile,
      workers: options?.workers,
    });
  }

  private loadSessionState(): SessionAutonomyState {
    const target = this.sessionStatePath();
    if (fs.existsSync(target)) {
      try {
        return JSON.parse(fs.readFileSync(target, 'utf8')) as SessionAutonomyState;
      } catch {
        // fall through to new state
      }
    }

    const sessionId = this.sessionDNA?.getSessionId?.() ?? `autonomy-${randomUUID().slice(0, 8)}`;
    return {
      runtimeId: this.runtime.getRuntimeId(),
      sessionId,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      lastPrompt: '',
      objectiveHistory: [],
      phases: [],
      mode: 'single-pass',
      repeatedFailures: 0,
      continuationDepth: 0,
      intent: { taskType: 'feature', riskClass: 'medium', complexity: 1 },
      selectedSpecialists: [],
      selectedSkills: [],
      selectedWorkflows: [],
      selectedHooks: [],
      selectedAutomations: [],
      lastMemoryMatches: [],
    };
  }

  private persistSessionState(): void {
    fs.writeFileSync(this.sessionStatePath(), JSON.stringify(this.sessionState, null, 2), 'utf8');
  }

  private sessionStatePath(): string {
    return path.join(this.sessionsDir, `${this.runtime.getRuntimeId()}.json`);
  }

  private resolvePrimaryClient(): RuntimePrimaryClientSnapshot | undefined {
    const primary = this.clientRegistry?.getPrimaryClient?.();
    if (primary) return this.toClientSnapshot(primary);
    const detected = this.detectCurrentClientFromEnv();
    return detected ? this.toClientSnapshot(detected) : undefined;
  }

  private listDetectedClients(): RuntimePrimaryClientSnapshot[] {
    const clients = this.clientRegistry?.listClients?.() ?? [];
    if (clients.length === 0) {
      const detected = this.detectCurrentClientFromEnv();
      return detected ? [this.toClientSnapshot(detected)] : [];
    }
    return clients.map((client) => this.toClientSnapshot(client));
  }

  private detectCurrentClientFromEnv(): ClientRecord | undefined {
    if (process.env.CODEX_HOME || process.env.CODEX_SESSION) {
      return {
        clientId: 'codex',
        displayName: 'Codex',
        state: 'primaryActive',
        source: 'manual',
        inferred: false,
        confidence: 1,
        evidence: ['env:CODEX detected'],
        metadata: {},
        lastSeen: Date.now(),
      };
    }
    if (process.env.CURSOR_HOME || process.env.CURSOR_SESSION) {
      return {
        clientId: 'cursor',
        displayName: 'Cursor',
        state: 'primaryActive',
        source: 'manual',
        inferred: false,
        confidence: 1,
        evidence: ['env:CURSOR detected'],
        metadata: {},
        lastSeen: Date.now(),
      };
    }
    if (process.env.CLAUDE_CODE || process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_PROJECT_DIR) {
      return {
        clientId: 'claude-code',
        displayName: 'Claude Code',
        state: 'primaryActive',
        source: 'manual',
        inferred: false,
        confidence: 1,
        evidence: ['env:CLAUDE detected'],
        metadata: {},
        lastSeen: Date.now(),
      };
    }
    if (process.env.OPENCODE_HOME) {
      return {
        clientId: 'opencode',
        displayName: 'Opencode',
        state: 'primaryActive',
        source: 'manual',
        inferred: false,
        confidence: 1,
        evidence: ['env:OPENCODE detected'],
        metadata: {},
        lastSeen: Date.now(),
      };
    }
    if (process.env.OPENCLAW_HOME || process.env.ANTIGRAVITY_HOME) {
      return {
        clientId: 'antigravity',
        displayName: 'Antigravity',
        state: 'primaryActive',
        source: 'manual',
        inferred: false,
        confidence: 1,
        evidence: ['env:ANTIGRAVITY detected'],
        metadata: {},
        lastSeen: Date.now(),
      };
    }
    if (process.env.WINDSURF_HOME || process.env.WINDSURF_SESSION) {
      return {
        clientId: 'windsurf',
        displayName: 'Windsurf',
        state: 'primaryActive',
        source: 'manual',
        inferred: false,
        confidence: 1,
        evidence: ['env:WINDSURF detected'],
        metadata: {},
        lastSeen: Date.now(),
      };
    }
    return undefined;
  }

  private toClientSnapshot(client: ClientRecord): RuntimePrimaryClientSnapshot {
    return {
      clientId: client.clientId,
      clientFamily: this.toClientFamily(client.clientId),
      displayName: client.displayName,
      state: client.state as RuntimePrimaryClientSnapshot['state'],
      source: client.source,
      confidence: client.confidence,
      evidence: client.evidence,
      lastSeen: client.lastSeen,
    };
  }

  private toRuntimeOrchestrationSnapshot(state: SessionAutonomyState): RuntimeOrchestrationSnapshot {
    return {
      sessionId: state.sessionId,
      lastPrompt: state.lastPrompt,
      taskType: state.intent.taskType,
      riskClass: state.intent.riskClass,
      mode: state.mode,
      phases: state.phases,
      objectiveHistory: state.objectiveHistory,
      selectedCrew: state.selectedCrew,
      selectedSpecialists: state.selectedSpecialists,
      selectedSkills: state.selectedSkills,
      selectedWorkflows: state.selectedWorkflows,
      selectedHooks: state.selectedHooks,
      selectedAutomations: state.selectedAutomations,
      repeatedFailures: state.repeatedFailures,
      continuationDepth: state.continuationDepth,
      latestSessionDNA: state.latestSessionDNA,
      lastUpdatedAt: state.updatedAt,
    };
  }

  private toGovernanceSnapshot(result: ReturnType<SubAgentRuntime['previewGovernancePreflight']>): GovernanceSnapshot {
    return {
      passed: result.passed,
      score: result.score,
      violations: result.violations.map((violation) => violation.id),
      suggestions: result.warnings.map((warning) => warning.id),
    };
  }

  private toClientFamily(clientId?: string): string {
    const normalized = String(clientId ?? 'codex').toLowerCase();
    if (normalized === 'openclaw' || normalized === 'antigravity') return 'antigravity';
    return normalized;
  }

  private classifyIntent(task: string): AutonomyIntent {
    const lower = task.toLowerCase();
    const taskType = lower.includes('release') || lower.includes('publish') || lower.includes('tag')
      ? 'release'
      : lower.includes('review') || lower.includes('audit')
        ? 'review'
        : lower.includes('research') || lower.includes('investigate')
          ? 'research'
          : lower.includes('refactor')
            ? 'refactor'
            : lower.includes('fix') || lower.includes('bug') || lower.includes('broken')
              ? 'bugfix'
              : lower.includes('deploy') || lower.includes('monitor') || lower.includes('ops')
                ? 'ops'
                : 'feature';
    const riskClass = lower.includes('delete') || lower.includes('migrate') || lower.includes('release') || lower.includes('security')
      ? 'high'
      : lower.includes('refactor') || lower.includes('planner') || lower.includes('orchestr')
        ? 'medium'
        : 'low';
    const complexity = Math.max(1, Math.min(6, this.decomposeTask(task).length + (task.length > 120 ? 1 : 0) + (riskClass === 'high' ? 1 : 0)));
    return { taskType, riskClass, complexity };
  }

  private discoverCandidateFiles(task: string): string[] {
    const keywords = extractKeywords(task);
    const candidates = this.walkRepo(this.repoRoot)
      .map((filePath) => ({
        filePath,
        score: scorePath(filePath, keywords),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath))
      .slice(0, MAX_DISCOVERED_FILES)
      .map((entry) => entry.filePath);

    if (candidates.length > 0) {
      return candidates;
    }

    return ['README.md', 'AGENTS.md', 'package.json']
      .map((entry) => path.join(this.repoRoot, entry))
      .filter((entry) => fs.existsSync(entry));
  }

  private walkRepo(root: string, seen: string[] = []): string[] {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (DISCOVERY_IGNORES.has(entry.name)) continue;
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        this.walkRepo(fullPath, seen);
        continue;
      }
      if (!DISCOVERY_EXTENSIONS.has(path.extname(entry.name))) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 200_000) continue;
      } catch {
        continue;
      }
      seen.push(fullPath);
    }
    return seen;
  }

  private toFileRef(filePath: string): FileRef | undefined {
    try {
      const stat = fs.statSync(filePath);
      return {
        path: filePath,
        sizeBytes: stat.size,
        lastModified: stat.mtimeMs,
      };
    } catch {
      return undefined;
    }
  }

  private pickCatalogNames(task: string, intent: AutonomyIntent, items: CatalogItem[], limit: number): string[] {
    const keywords = extractKeywords(`${task} ${intent.taskType} ${intent.riskClass}`);
    return items
      .map((item) => ({
        item,
        score: scoreText(`${item.name}\n${item.body}`, keywords),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name))
      .slice(0, limit)
      .map((entry) => entry.item.name);
  }

  private decideWorkers(
    requestedWorkers: number | undefined,
    plannedWorkers: number,
    phaseCount: number,
    intent: AutonomyIntent,
    repeatedFailures: number,
  ): number {
    if (typeof requestedWorkers === 'number' && requestedWorkers > 0) {
      return Math.max(2, Math.min(7, requestedWorkers));
    }
    const baseline = Math.max(2, plannedWorkers, phaseCount);
    const failureBoost = repeatedFailures > 0 ? 1 : 0;
    const riskBoost = intent.riskClass === 'high' ? 1 : 0;
    return Math.min(7, baseline + failureBoost + riskBoost);
  }

  private determineMode(intent: AutonomyIntent, phaseCount: number, workers: number): RuntimeOrchestrationSnapshot['mode'] {
    if (intent.taskType === 'release' || this.sessionState.repeatedFailures > 0) {
      return 'continuation-capable';
    }
    if (phaseCount > 1 || workers > 2 || intent.complexity >= 4) {
      return 'bounded-swarm';
    }
    return 'single-pass';
  }
}

function extractKeywords(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !['with', 'from', 'this', 'that', 'then', 'also', 'into', 'about'].includes(token));
}

function scoreText(value: string, keywords: string[]): number {
  const lower = value.toLowerCase();
  return keywords.reduce((sum, keyword) => {
    if (lower.includes(keyword)) return sum + 3;
    return sum;
  }, 0);
}

function scorePath(filePath: string, keywords: string[]): number {
  const normalized = filePath.toLowerCase();
  const baseScore = keywords.reduce((sum, keyword) => sum + (normalized.includes(keyword) ? 4 : 0), 0);
  if (normalized.includes('/src/')) return baseScore + 1;
  if (normalized.endsWith('.md')) return baseScore + 1;
  return baseScore;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export const createOrchestrator = (
  memory?: MemoryEngine,
  runtime?: SubAgentRuntime,
  clientRegistry?: ClientRegistry,
  sessionDNA?: SessionDNAManager,
  repoRoot?: string,
) => new OrchestratorEngine({ memory, runtime, clientRegistry, sessionDNA, repoRoot });
