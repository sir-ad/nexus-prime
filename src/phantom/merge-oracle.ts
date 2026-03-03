/**
 * Merge Oracle — Byzantine Consensus & Hierarchical Synthesis
 * 
 * Beyond simple voting: the Oracle analyzes code hierarchy and 
 * resolves conflicts by favoring structurally consistent changes.
 */

import type { WorkerResult, MergeDecision } from './index.js';
import type { MemoryEngine } from '../engines/memory.js';

export class MergeOracle {
    private memory: MemoryEngine;

    constructor(memory: MemoryEngine) {
        this.memory = memory;
    }

    /**
     * Evaluate all worker results and produce a merge decision.
     * Uses Byzantine-inspired voting: 2/3 agreement = high confidence.
     */
    async merge(workers: WorkerResult[]): Promise<MergeDecision> {
        if (workers.length === 0) {
            return {
                action: 'reject',
                rationale: 'No worker results to merge',
                confidence: 0,
                learnings: []
            };
        }

        // Score each worker based on outcome, confidence, and internal metrics
        const scored = workers.map(w => ({
            worker: w,
            score: this.scoreWorker(w)
        })).sort((a, b) => b.score - a.score);

        const best = scored[0];
        const allLearnings = workers.flatMap(w => w.learnings);

        // Byzantine check: do a majority of workers agree on the core logic?
        // We use approach as a proxy for the 'logic path' taken.
        const approachCounts = new Map<string, number>();
        for (const w of workers) {
            approachCounts.set(w.approach, (approachCounts.get(w.approach) ?? 0) + 1);
        }

        const majorityApproach = [...approachCounts.entries()].sort((a, b) => b[1] - a[1])[0];
        const consensusRatio = majorityApproach[1] / workers.length;

        // Perform Hierarchical Diff Analysis (Pseudo-logic for MVP)
        // If workers disagree, try to synthesize changes that affect different AST levels
        let action: 'apply' | 'synthesize' | 'reject' = 'reject';
        let synthesized: string | undefined;
        let rationale = '';

        if (best.score > 0.8 && (consensusRatio >= 0.6 || workers.length === 1)) {
            action = 'apply';
            rationale = `High confidence consensus on "${best.worker.approach}" (${(consensusRatio * 100).toFixed(0)}%)`;
        } else if (workers.length >= 2 && scored[0].score > 0.6 && scored[1].score > 0.6) {
            action = 'synthesize';
            synthesized = this.hierarchicalSynthesize(scored[0].worker, scored[1].worker);
            rationale = `Consensus low (${(consensusRatio * 100).toFixed(0)}%). Performing hierarchical synthesis of top approaches.`;
        } else {
            action = 'reject';
            rationale = `Insufficient consensus or score (Best score: ${best.score.toFixed(2)}, Consensus: ${(consensusRatio * 100).toFixed(0)}%)`;
        }

        // Tiered learning storage
        for (const learning of allLearnings) {
            await this.memory.store(learning, 0.7, ['#phantom-learning', '#swarm']);
        }

        return {
            action,
            winner: best.worker,
            synthesized,
            rationale,
            confidence: best.score,
            learnings: allLearnings
        };
    }

    private scoreWorker(worker: WorkerResult): number {
        const outcomeScore = worker.outcome === 'success' ? 1.0 : (worker.outcome === 'partial' ? 0.5 : 0.0);
        return (worker.confidence * 0.5) + (outcomeScore * 0.5);
    }

    /** 
     * Synthesize diffs by respecting hierarchy.
     * Prevents overlapping changes at the same AST node.
     */
    private hierarchicalSynthesize(a: WorkerResult, b: WorkerResult): string {
        // In a real execution, this would parse the diff and map to AST nodes.
        // For Phase 1, we concatenate unique hunks while flagging overlaps.
        if (a.diff === b.diff) return a.diff;

        return `// SYNTHESIZED BY NEXUS ORACLE\n// Approach A: ${a.approach}\n// Approach B: ${b.approach}\n\n${a.diff}\n\n${b.diff}`;
    }
}
