/**
 * Nexus Prime — Hilbert Space Math Primitives
 *
 * Classical simulation of quantum-like properties for agent coordination.
 * Provides tensor product, partial trace, Born rule sampling, and 
 * spherical interpolation in high-dimensional complex-valued spaces.
 *
 * Phase: 9A (Quantum-Inspired Agent Entanglement)
 *
 * IMPORTANT: This uses classical computation simulating quantum-like
 * properties, NOT actual quantum hardware. The approach exploits
 * distributional semantics in vector spaces to model "intuitive coordination."
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Complex number as [real, imaginary] tuple */
export type Complex = [number, number];

/** State vector: array of complex amplitudes */
export type StateVector = Complex[];

/** Density matrix: 2D array of complex entries */
export type DensityMatrix = Complex[][];

// ─────────────────────────────────────────────────────────────────────────────
// Complex Arithmetic
// ─────────────────────────────────────────────────────────────────────────────

export function cAdd(a: Complex, b: Complex): Complex {
    return [a[0] + b[0], a[1] + b[1]];
}

export function cMul(a: Complex, b: Complex): Complex {
    return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
}

export function cConj(a: Complex): Complex {
    return [a[0], -a[1]];
}

export function cAbs2(a: Complex): number {
    return a[0] * a[0] + a[1] * a[1];
}

export function cScale(a: Complex, s: number): Complex {
    return [a[0] * s, a[1] * s];
}

// ─────────────────────────────────────────────────────────────────────────────
// Vector Operations
// ─────────────────────────────────────────────────────────────────────────────

/** Normalize a state vector so probabilities sum to 1 */
export function normalize(v: StateVector): StateVector {
    const norm = Math.sqrt(v.reduce((sum, c) => sum + cAbs2(c), 0));
    if (norm < 1e-12) return v;
    return v.map(c => cScale(c, 1 / norm));
}

/** Inner product <a|b> */
export function innerProduct(a: StateVector, b: StateVector): Complex {
    let result: Complex = [0, 0];
    for (let i = 0; i < a.length && i < b.length; i++) {
        result = cAdd(result, cMul(cConj(a[i]), b[i]));
    }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tensor Product (combining agent subspaces)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tensor product |a⟩ ⊗ |b⟩ → combined Hilbert space.
 * Used to create joint quantum states for multiple agents.
 */
export function tensorProduct(a: StateVector, b: StateVector): StateVector {
    const result: StateVector = [];
    for (const ai of a) {
        for (const bi of b) {
            result.push(cMul(ai, bi));
        }
    }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Partial Trace (extracting one agent's state from joint system)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Partial trace: given a joint state |ψ⟩ of dimension dimA × dimB,
 * trace out subsystem B to get the reduced density matrix for A.
 *
 * Returns: dimA × dimA density matrix for subsystem A.
 */
export function partialTraceB(
    state: StateVector,
    dimA: number,
    dimB: number
): DensityMatrix {
    const rho: DensityMatrix = Array.from({ length: dimA }, () =>
        Array.from({ length: dimA }, (): Complex => [0, 0])
    );

    for (let i = 0; i < dimA; i++) {
        for (let j = 0; j < dimA; j++) {
            for (let k = 0; k < dimB; k++) {
                const idx_ik = i * dimB + k;
                const idx_jk = j * dimB + k;
                if (idx_ik < state.length && idx_jk < state.length) {
                    rho[i][j] = cAdd(
                        rho[i][j],
                        cMul(state[idx_ik], cConj(state[idx_jk]))
                    );
                }
            }
        }
    }
    return rho;
}

// ─────────────────────────────────────────────────────────────────────────────
// Born Rule (probabilistic measurement / strategy selection)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Born rule sampling: collapse a state vector by measurement.
 * Returns the index of the measured outcome, weighted by |amplitude|².
 *
 * This is the core mechanism: when an agent "measures" (executes),
 * the shared state collapses and correlated agents shift accordingly.
 */
export function bornRuleSample(state: StateVector): number {
    const probabilities = state.map(c => cAbs2(c));
    const total = probabilities.reduce((s, p) => s + p, 0);

    if (total < 1e-12) return 0;

    const r = Math.random() * total;
    let cumulative = 0;
    for (let i = 0; i < probabilities.length; i++) {
        cumulative += probabilities[i];
        if (r <= cumulative) return i;
    }
    return probabilities.length - 1;
}

/**
 * Get probability distribution from state vector (Born rule).
 */
export function probabilities(state: StateVector): number[] {
    const probs = state.map(c => cAbs2(c));
    const total = probs.reduce((s, p) => s + p, 0);
    if (total < 1e-12) return probs.map(() => 1 / probs.length);
    return probs.map(p => p / total);
}

// ─────────────────────────────────────────────────────────────────────────────
// State Preparation Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Create a uniform superposition over D strategies: |ψ⟩ = (1/√D) Σ|i⟩ */
export function uniformSuperposition(dim: number): StateVector {
    const amp = 1 / Math.sqrt(dim);
    return Array.from({ length: dim }, (): Complex => [amp, 0]);
}

/** Create an entangled Bell-like state for 2 agents with D strategies each.
 *  |Φ⟩ = (1/√D) Σ |i⟩⊗|i⟩ — maximally entangled.
 */
export function bellState(dim: number): StateVector {
    const totalDim = dim * dim;
    const state: StateVector = Array.from({ length: totalDim }, (): Complex => [0, 0]);
    const amp = 1 / Math.sqrt(dim);
    for (let i = 0; i < dim; i++) {
        state[i * dim + i] = [amp, 0]; // Amplitude on |i,i⟩ terms only
    }
    return state;
}

/** Create a GHZ-like state for N agents with D strategies each.
 *  |GHZ⟩ = (1/√D) Σ |i,i,...,i⟩ — all agents correlated.
 */
export function ghzState(numAgents: number, dim: number): StateVector {
    const totalDim = Math.pow(dim, numAgents);
    const state: StateVector = Array.from({ length: totalDim }, (): Complex => [0, 0]);
    const amp = 1 / Math.sqrt(dim);

    for (let i = 0; i < dim; i++) {
        // Index for |i,i,...,i⟩ in the tensor product space
        let idx = 0;
        for (let a = 0; a < numAgents; a++) {
            idx += i * Math.pow(dim, numAgents - 1 - a);
        }
        state[idx] = [amp, 0];
    }
    return state;
}

/**
 * Apply a bias (rotation) to one agent's subspace within a joint state.
 * This nudges the agent toward a preferred strategy without collapsing.
 *
 * @param state Joint state vector
 * @param agentIndex Which agent (0-indexed)
 * @param numAgents Total number of agents
 * @param dim Strategy dimension per agent
 * @param preferredStrategy Index of the preferred strategy
 * @param strength Bias strength 0.0 (no effect) to 1.0 (full collapse)
 */
export function applyBias(
    state: StateVector,
    agentIndex: number,
    numAgents: number,
    dim: number,
    preferredStrategy: number,
    strength: number
): StateVector {
    const s = Math.max(0, Math.min(1, strength));
    const result: StateVector = state.map(c => [...c] as Complex);

    const totalDim = Math.pow(dim, numAgents);

    for (let idx = 0; idx < totalDim && idx < result.length; idx++) {
        // Decode the multi-index to find this agent's strategy
        const agentStrategy = Math.floor(idx / Math.pow(dim, numAgents - 1 - agentIndex)) % dim;

        if (agentStrategy === preferredStrategy) {
            // Boost amplitude for preferred strategy
            result[idx] = cScale(result[idx], 1 + s);
        } else {
            // Suppress amplitude for non-preferred strategies
            result[idx] = cScale(result[idx], 1 - s * 0.5);
        }
    }

    return normalize(result);
}
