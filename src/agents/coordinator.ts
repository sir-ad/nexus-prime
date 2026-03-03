/**
 * Agent Coordination System
 * 
 * Swarm topologies and consensus protocols for multi-agent coordination.
 */

import { Agent, NetworkMessage, ConsensusState, NodeState } from '../core/types.js';
import { PhantomWorker, type WorkerTask } from '../phantom/index.js';
import { randomUUID } from 'crypto';
import { type FileRef } from '../engines/token-supremacy.js';
import * as fs from 'fs';
import * as path from 'path';

export type Topology = 'peer' | 'hierarchical' | 'ring' | 'star';
export type Consensus = 'raft' | 'bft' | 'gossip' | 'crdt';

export class AgentCoordinator {
  private agents: Map<string, Agent> = new Map();
  private topology: Topology;
  private consensus: Consensus;
  private consensusState: ConsensusState;

  constructor(
    topology: Topology = 'hierarchical',
    consensus: Consensus = 'raft'
  ) {
    this.topology = topology;
    this.consensus = consensus;
    this.consensusState = {
      type: consensus,
      term: 0,
      nodes: new Map()
    };
  }

  // ==================== AGENT MANAGEMENT ====================

  /**
   * Register an agent
   */
  register(agent: Agent): void {
    this.agents.set(agent.id, agent);

    // Add to consensus
    this.consensusState.nodes.set(agent.id, {
      id: agent.id,
      status: 'active',
      lastSeen: Date.now()
    });
  }

  /**
   * Unregister an agent
   */
  unregister(agentId: string): void {
    this.agents.delete(agentId);
    this.consensusState.nodes.get(agentId)!.status = 'failed';
  }

  /**
   * Get agent
   */
  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by type
   */
  getAgentsByType(type: Agent['type']): Agent[] {
    return Array.from(this.agents.values()).filter(a => a.type === type);
  }

  // ==================== TOPOLOGY ====================

  /**
   * Get neighbors for an agent based on topology
   */
  getNeighbors(agentId: string): string[] {
    switch (this.topology) {
      case 'peer':
        return this.getPeerNeighbors(agentId);
      case 'hierarchical':
        return this.getHierarchicalNeighbors(agentId);
      case 'ring':
        return this.getRingNeighbors(agentId);
      case 'star':
        return this.getStarNeighbors(agentId);
      default:
        return [];
    }
  }

  private getPeerNeighbors(agentId: string): string[] {
    // All other agents are neighbors (mesh)
    return Array.from(this.agents.keys()).filter(id => id !== agentId);
  }

  private getHierarchicalNeighbors(agentId: string): string[] {
    // Queen coordinates workers
    // Workers report to queen
    const agent = this.agents.get(agentId);
    if (!agent) return [];

    // For now, just return all other agents
    return Array.from(this.agents.keys()).filter(id => id !== agentId);
  }

  private getRingNeighbors(agentId: string): string[] {
    const ids = Array.from(this.agents.keys());
    const idx = ids.indexOf(agentId);

    if (idx === -1) return [];

    // Previous and next in ring
    const prev = idx - 1 < 0 ? ids.length - 1 : idx - 1;
    const next = idx + 1 >= ids.length ? 0 : idx + 1;

    return [ids[prev], ids[next]];
  }

  private getStarNeighbors(agentId: string): string[] {
    const ids = Array.from(this.agents.keys());
    const hub = ids[0]; // First agent is hub

    if (agentId === hub) {
      // Hub sees all spokes
      return ids.slice(1);
    }

    // Spoke sees only hub
    return [hub];
  }

  // ==================== COORDINATION ====================

  /**
   * Coordinate task across agents
   */
  async coordinate(
    task: string,
    agents: string[]
  ): Promise<Array<{ agentId: string; result: unknown }>> {
    const results: Array<{ agentId: string; result: unknown }> = [];

    switch (this.topology) {
      case 'hierarchical':
        // Queen delegates to workers
        results.push(...await this.hierarchicalCoordination(task, agents));
        break;
      case 'peer':
        // All agents work in parallel
        results.push(...await this.parallelCoordination(task, agents));
        break;
      case 'ring':
        // Sequential passing
        results.push(...await this.ringCoordination(task, agents));
        break;
      case 'star':
        // Hub delegates
        results.push(...await this.starCoordination(task, agents));
        break;
    }

    return results;
  }

  private async hierarchicalCoordination(
    task: string,
    agents: string[]
  ): Promise<Array<{ agentId: string; result: unknown }>> {
    // First agent is coordinator
    const coordinator = agents[0];
    const workers = agents.slice(1);

    // Coordinator distributes work
    const workChunks = this.distributeWork(task, workers.length);

    // Workers execute in parallel
    const workerResults = await Promise.all(
      workers.map((worker, i) => this.simulateWork(worker, workChunks[i]))
    );

    // Coordinator aggregates
    return [
      { agentId: coordinator, result: { aggregated: workerResults } },
      ...workerResults
    ];
  }

  private async parallelCoordination(
    task: string,
    agents: string[]
  ): Promise<Array<{ agentId: string; result: unknown }>> {
    const workChunks = this.distributeWork(task, agents.length);

    return Promise.all(
      agents.map((agent, i) => this.simulateWork(agent, workChunks[i]))
    );
  }

  private async ringCoordination(
    task: string,
    agents: string[]
  ): Promise<Array<{ agentId: string; result: unknown }>> {
    const results: Array<{ agentId: string; result: unknown }> = [];
    let currentTask = task;

    for (const agent of agents) {
      const result = await this.simulateWork(agent, currentTask);
      results.push(result);
      currentTask = `processed_${result.result}`;
    }

    return results;
  }

  private async starCoordination(
    task: string,
    agents: string[]
  ): Promise<Array<{ agentId: string; result: unknown }>> {
    const hub = agents[0];
    const spokes = agents.slice(1);

    // Hub distributes to spokes
    const workChunks = this.distributeWork(task, spokes.length);

    const spokeResults = await Promise.all(
      spokes.map((spoke, i) => this.simulateWork(spoke, workChunks[i]))
    );

    // Hub aggregates
    return [
      { agentId: hub, result: { aggregated: spokeResults } },
      ...spokeResults
    ];
  }

  private distributeWork(task: string, numChunks: number): string[] {
    // Simple distribution: split by words
    const words = task.split(/\s+/);
    const chunkSize = Math.ceil(words.length / numChunks);

    const chunks: string[] = [];
    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize;
      const end = start + chunkSize;
      chunks.push(words.slice(start, end).join(' '));
    }

    return chunks;
  }

  private async simulateWork(
    agentId: string,
    work: string
  ): Promise<{ agentId: string; result: unknown }> {
    const worker = new PhantomWorker();
    const task: WorkerTask = {
      id: randomUUID(),
      goal: work,
      files: [] as FileRef[],
      approach: 'standard',
      tokenBudget: 50000,
    };

    try {
      const result = await worker.spawn(task, async (worktreeDir, workerTask, w) => {
        const learnings: string[] = [];

        // Scan the worktree for relevant source files
        const srcDir = path.join(worktreeDir, 'src');
        const filesToRead: string[] = [];
        try {
          const entries = fs.readdirSync(srcDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile() && /\.[jt]s$/.test(entry.name)) {
              filesToRead.push(path.join(srcDir, entry.name));
            }
          }
        } catch { /* worktree may not have src/ */ }

        // Read first 500 bytes of up to 5 files for context
        for (const filePath of filesToRead.slice(0, 5)) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8').slice(0, 500);
            const fileName = path.basename(filePath);
            const exports = (content.match(/export\s+(class|function|const|interface)\s+\w+/g) || []);
            learnings.push(
              `[${agentId}] Analyzed ${fileName}: ${exports.length} exports, ${content.length} chars read`
            );
          } catch {
            learnings.push(`[${agentId}] Could not read ${path.basename(filePath)}`);
          }
        }

        // Broadcast findings to POD network
        w.broadcast(
          `Agent ${agentId} analyzed ${filesToRead.length} files for: ${workerTask.goal.slice(0, 60)}`,
          0.7,
          ['#coordinator', '#agent-work']
        );

        // Check peer findings
        const peerFindings = w.receive(['#coordinator']);
        if (peerFindings.length > 0) {
          learnings.push(`[${agentId}] Received ${peerFindings.length} peer findings`);
        }

        return {
          learnings: learnings.length > 0 ? learnings : [`[${agentId}] No source files found in worktree`],
          confidence: learnings.length > 2 ? 0.85 : 0.6,
        };
      });

      return {
        agentId,
        result: {
          diff: result.diff,
          outcome: result.outcome,
          learnings: result.learnings,
        }
      };
    } catch (err) {
      return {
        agentId,
        result: { outcome: 'failed', error: String(err) }
      };
    }
  }

  // ==================== CONSENSUS ====================

  /**
   * Achieve consensus on a decision
   */
  async consensusDecide(
    proposal: string,
    agents: string[]
  ): Promise<{ decided: boolean; result?: string }> {
    switch (this.consensus) {
      case 'raft':
        return this.raftConsensus(proposal, agents);
      case 'bft':
        return this.bftConsensus(proposal, agents);
      case 'gossip':
        return this.gossipConsensus(proposal, agents);
      case 'crdt':
        return this.crdtConsensus(proposal, agents);
      default:
        return { decided: false };
    }
  }

  private async raftConsensus(
    proposal: string,
    agents: string[]
  ): Promise<{ decided: boolean; result?: string }> {
    // Simple leader-based consensus
    const leader = this.consensusState.leader ?? agents[0];

    // Leader proposes
    const votes = await this.requestVotes(leader, proposal, agents);

    // Majority wins
    const majority = Math.ceil(agents.length / 2);
    const agree = votes.filter(v => v).length;

    if (agree >= majority) {
      return { decided: true, result: proposal };
    }

    return { decided: false };
  }

  private async bftConsensus(
    proposal: string,
    agents: string[]
  ): Promise<{ decided: boolean; result?: string }> {
    // Byzantine fault-tolerant: need 2/3 agreement
    const votes = await this.requestVotes('leader', proposal, agents);

    const byzantineThreshold = Math.ceil(agents.length * 2 / 3);
    const agree = votes.filter(v => v).length;

    if (agree >= byzantineThreshold) {
      return { decided: true, result: proposal };
    }

    return { decided: false };
  }

  private async gossipConsensus(
    proposal: string,
    agents: string[]
  ): Promise<{ decided: boolean; result?: string }> {
    // Gossip until convergence
    const values = new Set([proposal]);

    for (let round = 0; round < 5; round++) {
      // Each agent gossips with random neighbor
      for (const agent of agents) {
        const neighbor = agents[Math.floor(Math.random() * agents.length)];
        // Simulate gossip
        values.add(proposal);
      }
    }

    // Return most common value
    return { decided: true, result: proposal };
  }

  private async crdtConsensus(
    proposal: string,
    agents: string[]
  ): Promise<{ decided: boolean; result?: string }> {
    // CRDT: always converges
    // Last-write-wins for simplicity
    return { decided: true, result: proposal };
  }

  private async requestVotes(
    proposer: string,
    proposal: string,
    agents: string[]
  ): Promise<boolean[]> {
    // Simulate voting
    return agents.map(() => Math.random() > 0.3);
  }

  // ==================== STATE ====================

  getTopology(): Topology {
    return this.topology;
  }

  setTopology(topology: Topology): void {
    this.topology = topology;
  }

  getConsensus(): Consensus {
    return this.consensus;
  }

  setConsensus(consensus: Consensus): void {
    this.consensus = consensus;
    this.consensusState.type = consensus;
  }

  getConsensusState(): ConsensusState {
    return { ...this.consensusState };
  }
}

// ==================== FACTORY ====================

export const createCoordinator = (
  topology?: Topology,
  consensus?: Consensus
) => new AgentCoordinator(topology, consensus);
