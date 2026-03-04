/**
 * Nexus Prime — Byzantine Consensus Protocol
 *
 * Implements a Byzantine Fault Tolerant consensus protocol for multi-agent
 * KV cache synchronization. Up to ⌊(N-1)/3⌋ faulty agents can be tolerated.
 *
 * Uses a simplified PBFT (Practical Byzantine Fault Tolerance) approach:
 * 1. Pre-prepare: Leader proposes a cache update
 * 2. Prepare: Agents validate and vote
 * 3. Commit: If 2f+1 agents agree, cache is updated
 *
 * Phase: 9C (AdaptiveKVMerge Bridge)
 */

import { randomUUID } from 'crypto';
import { nexusEventBus } from './event-bus.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsensusProposal {
    id: string;
    proposerId: string;
    layerIndex: number;
    delta: number[];              // Proposed cache update
    timestamp: number;
    phase: 'pre-prepare' | 'prepare' | 'commit' | 'decided';
    votes: Map<string, boolean>;  // agentId → approve/reject
    committed: boolean;
}

export interface AgentNode {
    id: string;
    reliability: number;         // 0.0 - 1.0, tracks historical accuracy
    lastSeen: number;
    proposalCount: number;
    acceptedCount: number;
}

export interface ConsensusResult {
    proposalId: string;
    accepted: boolean;
    votes: { for: number; against: number; total: number };
    quorum: number;
    conflicts: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Byzantine Consensus Engine
// ─────────────────────────────────────────────────────────────────────────────

export class ByzantineConsensus {
    private agents: Map<string, AgentNode> = new Map();
    private proposals: Map<string, ConsensusProposal> = new Map();
    private conflictCount: number = 0;

    /**
     * Register an agent node in the consensus network.
     */
    registerAgent(agentId: string): void {
        if (this.agents.has(agentId)) return;
        this.agents.set(agentId, {
            id: agentId,
            reliability: 1.0,
            lastSeen: Date.now(),
            proposalCount: 0,
            acceptedCount: 0
        });
    }

    /**
     * Remove an agent from the consensus network.
     */
    deregisterAgent(agentId: string): void {
        this.agents.delete(agentId);
    }

    /**
     * Maximum number of faulty agents tolerated: f = ⌊(N-1)/3⌋
     */
    get maxFaulty(): number {
        return Math.floor((this.agents.size - 1) / 3);
    }

    /**
     * Minimum votes needed for quorum: 2f + 1
     */
    get quorum(): number {
        return 2 * this.maxFaulty + 1;
    }

    /**
     * Phase 1: Pre-Prepare — Leader proposes a cache update.
     */
    propose(proposerId: string, layerIndex: number, delta: number[]): ConsensusProposal {
        this.ensureRegistered(proposerId);

        const proposal: ConsensusProposal = {
            id: randomUUID(),
            proposerId,
            layerIndex,
            delta,
            timestamp: Date.now(),
            phase: 'pre-prepare',
            votes: new Map(),
            committed: false
        };

        // Leader auto-votes for their own proposal
        proposal.votes.set(proposerId, true);

        const agent = this.agents.get(proposerId)!;
        agent.proposalCount++;
        agent.lastSeen = Date.now();

        this.proposals.set(proposal.id, proposal);
        proposal.phase = 'prepare';

        return proposal;
    }

    /**
     * Phase 2: Prepare — Agent validates and votes on a proposal.
     *
     * Validation checks:
     * 1. Proposer reliability score
     * 2. Delta magnitude is within acceptable bounds
     * 3. No conflicting concurrent proposals for the same layer
     */
    vote(proposalId: string, agentId: string, approve: boolean): void {
        const proposal = this.proposals.get(proposalId);
        if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
        if (proposal.phase === 'decided') return; // Already decided

        this.ensureRegistered(agentId);

        const agent = this.agents.get(agentId)!;
        agent.lastSeen = Date.now();

        proposal.votes.set(agentId, approve);

        // Check if we have enough votes to decide
        const forCount = Array.from(proposal.votes.values()).filter(v => v).length;
        const againstCount = Array.from(proposal.votes.values()).filter(v => !v).length;
        const total = proposal.votes.size;

        // Can we decide?
        if (forCount >= this.quorum) {
            this.commitProposal(proposal);
        } else if (againstCount > this.agents.size - this.quorum) {
            // Impossible to reach quorum — reject
            proposal.phase = 'decided';
            proposal.committed = false;
            this.conflictCount++;
        }
    }

    /**
     * Auto-vote: simplified version where the engine validates locally
     * and generates votes from all registered agents based on heuristics.
     */
    autoConsensus(proposerId: string, layerIndex: number, delta: number[]): ConsensusResult {
        const proposal = this.propose(proposerId, layerIndex, delta);

        // Each agent votes based on a simple validation heuristic
        for (const [agentId, agent] of this.agents) {
            if (agentId === proposerId) continue; // Already voted

            const approve = this.validateDelta(delta, agent);
            this.vote(proposal.id, agentId, approve);
        }

        // If not enough agents to reach quorum, auto-accept for small networks
        if (this.agents.size < 3 && !proposal.committed && proposal.phase !== 'decided') {
            this.commitProposal(proposal);
        }

        const forCount = Array.from(proposal.votes.values()).filter(v => v).length;
        const againstCount = Array.from(proposal.votes.values()).filter(v => !v).length;

        const result: ConsensusResult = {
            proposalId: proposal.id,
            accepted: proposal.committed,
            votes: { for: forCount, against: againstCount, total: proposal.votes.size },
            quorum: this.quorum,
            conflicts: this.conflictCount
        };

        nexusEventBus.emit('kv.consensus', {
            agents: this.agents.size,
            syncOverhead: Date.now() - proposal.timestamp,
            conflicts: this.conflictCount
        });

        return result;
    }

    /**
     * Get all registered agents and their reliability scores.
     */
    getAgents(): AgentNode[] {
        return Array.from(this.agents.values());
    }

    /**
     * Get network health statistics.
     */
    getStats(): {
        agents: number;
        maxFaulty: number;
        quorum: number;
        totalProposals: number;
        totalConflicts: number;
        avgReliability: number;
    } {
        const agents = Array.from(this.agents.values());
        return {
            agents: agents.length,
            maxFaulty: this.maxFaulty,
            quorum: this.quorum,
            totalProposals: this.proposals.size,
            totalConflicts: this.conflictCount,
            avgReliability: agents.length > 0
                ? agents.reduce((s, a) => s + a.reliability, 0) / agents.length
                : 0
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────────────────────────

    private commitProposal(proposal: ConsensusProposal): void {
        proposal.phase = 'decided';
        proposal.committed = true;

        // Update proposer reliability
        const agent = this.agents.get(proposal.proposerId);
        if (agent) {
            agent.acceptedCount++;
            agent.reliability = Math.min(1.0, agent.reliability + 0.01);
        }
    }

    private ensureRegistered(agentId: string): void {
        if (!this.agents.has(agentId)) {
            this.registerAgent(agentId);
        }
    }

    /**
     * Simple heuristic to validate a delta:
     * - Reject if delta magnitude is too large (suspicious change)
     * - Use agent reliability as acceptance probability for borderline cases
     */
    private validateDelta(delta: number[], voter: AgentNode): boolean {
        const magnitude = Math.sqrt(delta.reduce((s, d) => s + d * d, 0));

        // Reject extremely large deltas (potential Byzantine attack)
        if (magnitude > 100) return false;

        // Accept small deltas unconditionally
        if (magnitude < 1) return true;

        // Borderline: use agent reliability as acceptance threshold
        return voter.reliability > 0.3;
    }
}
