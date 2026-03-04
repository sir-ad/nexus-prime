/**
 * Nexus Prime — Quantum-Inspired Agent Entanglement Engine
 *
 * Replaces explicit IPC/Git-based coordination with a shared quantum-state
 * vector that enables "telepathic" correlated agent decisions.
 *
 * Agents share a state in a high-dimensional Hilbert space. When an agent
 * "measures" (executes an action), the shared state collapses, and entangled
 * agents automatically make correlated decisions without explicit messaging.
 *
 * Phase: 9A (Quantum-Inspired Agent Entanglement)
 */

import { randomUUID } from 'crypto';
import {
    type StateVector,
    type Complex,
    ghzState,
    bellState,
    normalize,
    bornRuleSample,
    probabilities,
    applyBias,
    partialTraceB,
    cAbs2
} from './hilbert-space.js';
import { nexusEventBus } from './event-bus.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EntangledState {
    id: string;
    dimension: number;           // Strategy dimension per agent
    numAgents: number;
    amplitudes: StateVector;     // Complex amplitudes in joint Hilbert space
    agentIds: string[];          // Ordered agent IDs mapping to subspaces
    collapsed: Map<string, number>; // Agents that have already measured
    created: number;
    lastMeasurement: number;
}

export interface MeasurementResult {
    agentId: string;
    strategyIndex: number;
    probability: number;         // How likely this outcome was
    correlations: Map<string, number[]>; // Other agents' shifted probability distributions
}

export interface CorrelationEntry {
    agentA: string;
    agentB: string;
    correlation: number;         // -1 to +1. High positive = strong entanglement
}

// ─────────────────────────────────────────────────────────────────────────────
// Entanglement Engine
// ─────────────────────────────────────────────────────────────────────────────

export class EntanglementEngine {
    private states: Map<string, EntangledState> = new Map();

    /**
     * Create a new entangled state for N agents.
     *
     * Produces a GHZ-like maximally entangled state where all agents
     * are perfectly correlated — measuring one immediately constrains others.
     *
     * @param agentIds  Array of agent identifiers
     * @param strategyDim Number of possible strategies per agent (default: 4)
     * @returns The EntangledState ID
     */
    entangle(agentIds: string[], strategyDim: number = 4): EntangledState {
        if (agentIds.length < 2) {
            throw new Error('Entanglement requires at least 2 agents');
        }
        if (strategyDim < 2) {
            throw new Error('Strategy dimension must be ≥ 2');
        }

        // Use Bell state for 2 agents, GHZ for 3+
        const amplitudes = agentIds.length === 2
            ? bellState(strategyDim)
            : ghzState(agentIds.length, strategyDim);

        const state: EntangledState = {
            id: randomUUID(),
            dimension: strategyDim,
            numAgents: agentIds.length,
            amplitudes,
            agentIds: [...agentIds],
            collapsed: new Map(),
            created: Date.now(),
            lastMeasurement: 0
        };

        this.states.set(state.id, state);

        nexusEventBus.emit('entanglement.create' as any, {
            stateId: state.id,
            agents: agentIds.length,
            dimension: strategyDim,
            type: agentIds.length === 2 ? 'bell' : 'ghz'
        });

        return state;
    }

    /**
     * Agent "measures" — collapses its subspace, returns chosen strategy.
     *
     * Born rule sampling selects a strategy weighted by |amplitude|².
     * After measurement, the joint state is updated so entangled agents
     * make correlated decisions on their subsequent measurements.
     */
    measure(stateId: string, agentId: string): MeasurementResult {
        const state = this.states.get(stateId);
        if (!state) throw new Error(`Entangled state ${stateId} not found`);

        const agentIndex = state.agentIds.indexOf(agentId);
        if (agentIndex === -1) throw new Error(`Agent ${agentId} not in entangled state`);
        if (state.collapsed.has(agentId)) {
            // Already measured — return cached result
            const cached = state.collapsed.get(agentId)!;
            return {
                agentId,
                strategyIndex: cached,
                probability: 1.0,
                correlations: this.getCorrelationsAfterMeasurement(state, agentId, cached)
            };
        }

        // Extract this agent's marginal probabilities from the joint state
        const marginalProbs = this.getMarginalProbabilities(state, agentIndex);

        // Born rule: sample from marginal distribution
        const marginalState: StateVector = marginalProbs.map(p => [Math.sqrt(p), 0] as Complex);
        const chosenStrategy = bornRuleSample(marginalState);
        const chosenProbability = marginalProbs[chosenStrategy];

        // Collapse: project joint state onto the measured outcome
        state.amplitudes = this.collapseOnMeasurement(
            state.amplitudes,
            agentIndex,
            state.numAgents,
            state.dimension,
            chosenStrategy
        );

        // Record the measurement
        state.collapsed.set(agentId, chosenStrategy);
        state.lastMeasurement = Date.now();

        // Compute how other agents' distributions shifted
        const correlations = this.getCorrelationsAfterMeasurement(state, agentId, chosenStrategy);

        nexusEventBus.emit('entanglement.collapse' as any, {
            stateId: state.id,
            agentId,
            strategy: chosenStrategy,
            probability: chosenProbability,
            remainingAgents: state.numAgents - state.collapsed.size
        });

        return {
            agentId,
            strategyIndex: chosenStrategy,
            probability: chosenProbability,
            correlations
        };
    }

    /**
     * Inject bias: push an agent toward a preferred strategy without collapsing.
     *
     * This is like "nudging" — the agent becomes more likely to choose
     * the preferred strategy, while still maintaining entanglement with others.
     */
    bias(stateId: string, agentId: string, strategyIdx: number, strength: number): void {
        const state = this.states.get(stateId);
        if (!state) throw new Error(`State ${stateId} not found`);

        const agentIndex = state.agentIds.indexOf(agentId);
        if (agentIndex === -1) throw new Error(`Agent ${agentId} not in state`);

        state.amplitudes = applyBias(
            state.amplitudes,
            agentIndex,
            state.numAgents,
            state.dimension,
            strategyIdx,
            strength
        );
    }

    /**
     * Get the correlation matrix between all agent pairs.
     * High correlation means agents tend to choose the same strategies.
     */
    getCorrelationMatrix(stateId: string): CorrelationEntry[] {
        const state = this.states.get(stateId);
        if (!state) throw new Error(`State ${stateId} not found`);

        const entries: CorrelationEntry[] = [];
        const probs = probabilities(state.amplitudes);

        for (let a = 0; a < state.numAgents; a++) {
            for (let b = a + 1; b < state.numAgents; b++) {
                const correlation = this.pairCorrelation(
                    probs, a, b, state.numAgents, state.dimension
                );
                entries.push({
                    agentA: state.agentIds[a],
                    agentB: state.agentIds[b],
                    correlation
                });
            }
        }

        nexusEventBus.emit('entanglement.correlate' as any, {
            stateId: state.id,
            pairs: entries.length,
            avgCorrelation: entries.reduce((s, e) => s + e.correlation, 0) / entries.length
        });

        return entries;
    }

    /**
     * Get all active entangled states.
     */
    getStates(): EntangledState[] {
        return Array.from(this.states.values());
    }

    /**
     * Destroy an entangled state after use.
     */
    destroy(stateId: string): void {
        this.states.delete(stateId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Compute marginal probabilities for a specific agent by tracing out
     * all other agents from the joint probability distribution.
     */
    private getMarginalProbabilities(state: EntangledState, agentIndex: number): number[] {
        const probs = probabilities(state.amplitudes);
        const marginal = new Array(state.dimension).fill(0);

        for (let idx = 0; idx < probs.length; idx++) {
            const agentStrategy = Math.floor(
                idx / Math.pow(state.dimension, state.numAgents - 1 - agentIndex)
            ) % state.dimension;
            marginal[agentStrategy] += probs[idx];
        }

        return marginal;
    }

    /**
     * Collapse the joint state after measurement.
     * Projects onto the subspace where the measured agent has `outcome`.
     * Zeroes out all amplitudes where that agent has a different strategy.
     */
    private collapseOnMeasurement(
        amplitudes: StateVector,
        agentIndex: number,
        numAgents: number,
        dim: number,
        outcome: number
    ): StateVector {
        const result: StateVector = amplitudes.map((c, idx) => {
            const agentStrategy = Math.floor(
                idx / Math.pow(dim, numAgents - 1 - agentIndex)
            ) % dim;
            return agentStrategy === outcome ? [...c] as Complex : [0, 0] as Complex;
        });
        return normalize(result);
    }

    /**
     * After one agent measures, compute the shifted probability distributions
     * for all other agents (showing how entanglement constrains them).
     */
    private getCorrelationsAfterMeasurement(
        state: EntangledState,
        measuredAgentId: string,
        _outcome: number
    ): Map<string, number[]> {
        const correlations = new Map<string, number[]>();

        for (let i = 0; i < state.agentIds.length; i++) {
            const otherId = state.agentIds[i];
            if (otherId === measuredAgentId) continue;

            const marginal = this.getMarginalProbabilities(state, i);
            correlations.set(otherId, marginal);
        }

        return correlations;
    }

    /**
     * Pearson correlation between two agents' strategies in the joint distribution.
     * Returns value in [-1, 1].
     */
    private pairCorrelation(
        jointProbs: number[],
        agentA: number,
        agentB: number,
        numAgents: number,
        dim: number
    ): number {
        // Compute E[A], E[B], E[AB], Var[A], Var[B]
        let eA = 0, eB = 0, eAB = 0, eA2 = 0, eB2 = 0;

        for (let idx = 0; idx < jointProbs.length; idx++) {
            const p = jointProbs[idx];
            const stratA = Math.floor(idx / Math.pow(dim, numAgents - 1 - agentA)) % dim;
            const stratB = Math.floor(idx / Math.pow(dim, numAgents - 1 - agentB)) % dim;

            eA += stratA * p;
            eB += stratB * p;
            eAB += stratA * stratB * p;
            eA2 += stratA * stratA * p;
            eB2 += stratB * stratB * p;
        }

        const varA = eA2 - eA * eA;
        const varB = eB2 - eB * eB;

        if (varA < 1e-12 || varB < 1e-12) return 1.0; // Degenerate: perfectly correlated

        return (eAB - eA * eB) / Math.sqrt(varA * varB);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

export const entanglementEngine = new EntanglementEngine();
