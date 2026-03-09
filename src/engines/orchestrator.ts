/**
 * Orchestrator Engine
 * 
 * Coordinates multiple agents with consensus and dynamic induction (v1.5).
 */

import { MemoryEngine } from './memory.js';
import { nxl, AgentArchetype } from './nxl-interpreter.js';
import { nexusEventBus } from './event-bus.js';
import {
  createSubAgentRuntime,
  type ExecutionRun,
  type ExecutionTask,
  type SubAgentRuntime
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

export class OrchestratorEngine {
  private agents: Map<string, Agent> = new Map();
  private memory: MemoryEngine;
  private agentCounter = 0;
  private runtime: SubAgentRuntime;
  private lastRun: ExecutionRun | null = null;

  constructor(memory?: MemoryEngine, runtime?: SubAgentRuntime) {
    this.memory = memory || new MemoryEngine();
    this.runtime = runtime || createSubAgentRuntime({
      repoRoot: process.cwd(),
      memory: this.memory
    });
  }

  /**
   * Induces a specialized "army" of agents based on the query.
   * This is Worker EPSILON's core logic.
   */
  public async induce(task: string): Promise<Agent[]> {
    const archetypes = nxl.induceArmy(task);
    const inductedAgents: Agent[] = [];

    for (const arch of archetypes) {
      const id = `agent_${++this.agentCounter}_${arch.name.toLowerCase().replace(/\s+/g, '_')}`;
      const agent: Agent = {
        id,
        type: arch.role,
        task, // The overall goal
        state: 'pending',
        archetype: arch
      };
      this.agents.set(id, agent);
      inductedAgents.push(agent);
    }

    nexusEventBus.emit('nexusnet.sync', { newItemsCount: inductedAgents.length }); // Signaling recruitment

    console.error(`\x1b[36m[Orchestrator]\x1b[0m Induced ${inductedAgents.length} agents for task: ${task}`);
    inductedAgents.forEach(a => {
      console.error(`  • \x1b[32m${a.archetype?.name}\x1b[0m as ${a.archetype?.role}`);
    });

    return inductedAgents;
  }

  /**
   * Decompose a task into subtasks
   */
  public decomposeTask(task: string): string[] {
    const subtasks = task
      .split(/,| and | then /)
      .map(s => s.trim())
      .filter(Boolean);

    return subtasks.length > 0 ? subtasks : [task];
  }

  /**
   * Execute a task with the inducted army.
   */
  public async executeSwarm(task: string, options?: Partial<ExecutionTask>): Promise<ExecutionRun> {
    const army = await this.induce(task);

    army.forEach(a => a.state = 'running');

    // Store in memory
    this.memory.store(
      `Nexus Swarm (size=${army.length}) induced for: ${task}`,
      0.9,
      ['#swarm', '#orchestration']
    );

    const run = await this.runtime.run({
      goal: task,
      workers: options?.workers ?? Math.max(1, army.length),
      roles: options?.roles ?? army.map(agent => String(agent.type)),
      strategies: options?.strategies,
      files: options?.files,
      verifyCommands: options?.verifyCommands,
      successCriteria: options?.successCriteria,
      rollbackPolicy: options?.rollbackPolicy,
      timeoutMs: options?.timeoutMs,
      skillPolicy: options?.skillPolicy,
      backendSelectors: options?.backendSelectors,
      skillNames: options?.skillNames,
      actions: options?.actions,
      inlineSkills: options?.inlineSkills,
      nxlScript: options?.nxlScript,
    });
    this.lastRun = run;

    army.forEach(a => {
      a.state = run.state === 'failed' ? 'failed' : 'complete';
      a.result = run.result;
    });

    return run;
  }

  public getAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  public getLastRun(): ExecutionRun | null {
    return this.lastRun;
  }
}

export const createOrchestrator = (memory?: MemoryEngine, runtime?: SubAgentRuntime) =>
  new OrchestratorEngine(memory, runtime);
