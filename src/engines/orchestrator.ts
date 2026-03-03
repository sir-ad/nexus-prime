/**
 * Orchestrator Engine
 * 
 * Coordinates multiple agents with consensus.
 */

import { MemoryEngine } from './memory.js';
import * as fs from 'fs';
import * as path from 'path';

export type AgentType = 'researcher' | 'coder' | 'planner' | 'executor' | 'reviewer';

export interface Agent {
  id: string;
  type: AgentType;
  task: string;
  state: 'pending' | 'running' | 'complete' | 'failed';
  result?: string;
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
  private consensusThreshold = 0.6;
  private agentCounter = 0;

  constructor(memory?: MemoryEngine) {
    this.memory = memory || new MemoryEngine();
  }

  /**
   * Decompose a task into subtasks
   */
  decomposeTask(task: string): string[] {
    // Simple decomposition - split by 'and', 'then'
    const subtasks = task
      .split(/,| and | then /)
      .map(s => s.trim())
      .filter(Boolean);

    return subtasks.length > 0 ? subtasks : [task];
  }

  /**
   * Spawn an agent
   */
  spawn(type: AgentType, task: string): string {
    const id = `${type}_${++this.agentCounter}`;

    const agent: Agent = {
      id,
      type,
      task,
      state: 'pending'
    };

    this.agents.set(id, agent);

    // Store in memory
    this.memory.store(
      `Agent ${id} (${type}) created for: ${task}`,
      0.5,
      ['agent', type]
    );

    return id;
  }

  /**
   * Execute a task with agents
   */
  async execute(task: string): Promise<{
    result: string;
    agents: Agent[];
    consensus: boolean;
  }> {
    // Decompose task
    const subtasks = this.decomposeTask(task);

    // Spawn agents for each subtask
    const agentIds: string[] = [];

    for (const subtask of subtasks) {
      const type = this.getAgentType(subtask);
      const id = this.spawn(type, subtask);
      agentIds.push(id);
    }

    // Execute in parallel
    const results = await Promise.all(
      agentIds.map(id => this.runAgent(id))
    );

    // Aggregate with consensus
    const consensus = this.checkConsensus(results);
    const aggregated = this.aggregateResults(results);

    return {
      result: aggregated,
      agents: results.map(r => r.agent),
      consensus
    };
  }

  /**
   * Run a single agent
   */
  private async runAgent(agentId: string): Promise<{ agent: Agent; result: string }> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Update state
    agent.state = 'running';

    // Store intent in memory before execution
    this.memory.store(
      `Agent ${agentId} (${agent.type}) starting: ${agent.task}`,
      0.5,
      ['execution-start', agent.type]
    );

    // ── Recall relevant context ──
    const recalled = await this.memory.recall(agent.task, 3);

    // ── Scan source files for task-relevant content ──
    const findings: string[] = [];
    try {
      const srcDir = path.join(process.cwd(), 'src');
      const entries = fs.readdirSync(srcDir, { withFileTypes: true });
      const taskLower = agent.task.toLowerCase();

      for (const entry of entries) {
        if (!entry.isFile() || !/\.[jt]s$/.test(entry.name)) continue;
        // Check if file name is relevant to the task
        const nameLower = entry.name.toLowerCase().replace(/\.[^.]+$/, '');
        if (taskLower.includes(nameLower) || nameLower.includes('index')) {
          try {
            const content = fs.readFileSync(path.join(srcDir, entry.name), 'utf-8').slice(0, 300);
            const exports = (content.match(/export\s+(class|function|const|interface)\s+\w+/g) || []);
            findings.push(`${entry.name}: ${exports.length} exports`);
          } catch { /* skip unreadable */ }
        }
      }
    } catch { /* no src/ dir */ }

    // ── Build result ──
    const resultParts: string[] = [];
    if (recalled.length > 0) {
      resultParts.push(`Context: ${recalled.length} prior memories applied`);
    }
    if (findings.length > 0) {
      resultParts.push(`Analyzed: ${findings.join(', ')}`);
    }
    resultParts.push(`Task: ${agent.task}`);

    const result = resultParts.join(' | ');

    // Update agent
    agent.state = 'complete';
    agent.result = result;

    // Store result in memory
    this.memory.store(
      result,
      0.7,
      ['result', agent.type]
    );

    return { agent, result };
  }

  /**
   * Get agent type based on task
   */
  private getAgentType(task: string): AgentType {
    const t = task.toLowerCase();

    if (t.includes('research') || t.includes('find') || t.includes('search')) {
      return 'researcher';
    }
    if (t.includes('build') || t.includes('create') || t.includes('code')) {
      return 'coder';
    }
    if (t.includes('plan') || t.includes('design')) {
      return 'planner';
    }
    if (t.includes('review') || t.includes('check')) {
      return 'reviewer';
    }

    return 'executor';
  }

  /**
   * Check consensus among results
   */
  private checkConsensus(results: Array<{ result: string }>): boolean {
    if (results.length < 2) return true;

    // Simple consensus: similar results
    const first = results[0].result;
    const similar = results.filter(r =>
      this.similarity(first, r.result) > this.consensusThreshold
    );

    return similar.length / results.length >= this.consensusThreshold;
  }

  /**
   * Aggregate results
   */
  private aggregateResults(results: Array<{ result: string }>): string {
    return results.map(r => r.result).join(' | ');
  }

  /**
   * Simple similarity
   */
  private similarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));

    const intersection = [...wordsA].filter(x => wordsB.has(x));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.length / (union.size || 1);
  }

  /**
   * Get all agents
   */
  getAgents(): Agent[] {
    return Array.from(this.agents.values());
  }
}

export const createOrchestrator = (memory?: MemoryEngine) =>
  new OrchestratorEngine(memory);
