/**
 * Orchestrator Engine
 * 
 * Coordinates multiple agents with consensus and dynamic induction (v1.5).
 */

import { MemoryEngine } from './memory.js';
import { nxl, AgentArchetype } from './nxl-interpreter.js';
import { nexusEventBus } from './event-bus.js';
import * as fs from 'fs';
import * as path from 'path';

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

  constructor(memory?: MemoryEngine) {
    this.memory = memory || new MemoryEngine();
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
  public async executeSwarm(task: string): Promise<{ result: string; agents: Agent[] }> {
    const army = await this.induce(task);

    // Mocking execution for now
    army.forEach(a => a.state = 'running');

    // Store in memory
    this.memory.store(
      `Nexus Swarm (size=${army.length}) induced for: ${task}`,
      0.9,
      ['#swarm', '#orchestration']
    );

    // ... in a real implementation, we would dispatch to parallel worktrees here ...
    // ... Worker ZETA verifies the UX during this runtime ...

    army.forEach(a => {
      a.state = 'complete';
      a.result = `Executed as ${a.archetype?.name}`;
    });

    return {
      result: `Swarm of ${army.length} agents completed task: ${task}`,
      agents: army
    };
  }

  public getAgents(): Agent[] {
    return Array.from(this.agents.values());
  }
}

export const createOrchestrator = (memory?: MemoryEngine) => new OrchestratorEngine(memory);
