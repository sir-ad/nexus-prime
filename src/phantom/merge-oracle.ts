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
                learnings: [],
                conflicts: [],
                recommendedStrategy: 'Retry with different approach'
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

        // Extract conflicts from synthesis if it occurred
        const conflicts: string[] = [];
        if (action === 'synthesize' && scored.length >= 2) {
            const hunksA = this.parseHunks(scored[0].worker.diff);
            const hunksB = this.parseHunks(scored[1].worker.diff);
            const overlap = this.detectOverlaps(hunksA, hunksB);
            conflicts.push(...overlap.conflicts);
        }

        return {
            action,
            winner: best.worker,
            synthesized,
            rationale,
            confidence: best.score,
            learnings: allLearnings,
            conflicts,
            recommendedStrategy: action === 'apply' ? 'Direct apply of best result' : (conflicts.length > 0 ? 'Conflict-aware synthesis (primary approach favored)' : 'Clean AST-level synthesis')
        };
    }

    private scoreWorker(worker: WorkerResult): number {
        const outcomeScore = worker.outcome === 'success' ? 1.0 : (worker.outcome === 'partial' ? 0.5 : 0.0);
        return (worker.confidence * 0.5) + (outcomeScore * 0.5);
    }

    /**
     * Parse a unified diff string into individual hunks.
     * Each hunk has: file, startLine, endLine, content.
     */
    private parseHunks(diff: string): Array<{ file: string; startLine: number; endLine: number; content: string }> {
        if (!diff || diff.trim().length === 0) return [];

        const hunks: Array<{ file: string; startLine: number; endLine: number; content: string }> = [];
        const lines = diff.split('\n');
        let currentFile = 'unknown';
        let currentHunkStart = 0;
        let currentHunkEnd = 0;
        let currentContent: string[] = [];

        for (const line of lines) {
            // Detect file header: +++ b/path/to/file.ts
            if (line.startsWith('+++ b/') || line.startsWith('+++ ')) {
                currentFile = line.replace(/^\+\+\+ [ab]\//, '').trim();
            }
            // Detect hunk header: @@ -10,5 +10,7 @@
            else if (line.startsWith('@@')) {
                // Save previous hunk if exists
                if (currentContent.length > 0) {
                    hunks.push({ file: currentFile, startLine: currentHunkStart, endLine: currentHunkEnd, content: currentContent.join('\n') });
                }
                // Parse new hunk range
                const match = line.match(/@@ -(\d+),?\d* \+(\d+),?(\d*) @@/);
                if (match) {
                    currentHunkStart = parseInt(match[2], 10);
                    currentHunkEnd = currentHunkStart + parseInt(match[3] || '1', 10);
                }
                currentContent = [line];
            }
            else if (currentContent.length > 0) {
                currentContent.push(line);
            }
        }

        // Push last hunk
        if (currentContent.length > 0) {
            hunks.push({ file: currentFile, startLine: currentHunkStart, endLine: currentHunkEnd, content: currentContent.join('\n') });
        }

        return hunks;
    }

    /**
     * Detect overlapping hunks between two sets.
     * Returns: { overlapping: string[], nonOverlapping: string[] }
     */
    private detectOverlaps(
        hunksA: Array<{ file: string; startLine: number; endLine: number; content: string }>,
        hunksB: Array<{ file: string; startLine: number; endLine: number; content: string }>
    ): { conflicts: string[]; merged: string } {
        const conflicts: string[] = [];
        const usedB = new Set<number>();

        const resultParts: string[] = [];

        for (const hunkA of hunksA) {
            let hasConflict = false;
            for (let i = 0; i < hunksB.length; i++) {
                const hunkB = hunksB[i];
                // Same file + overlapping line range = conflict
                if (hunkA.file === hunkB.file &&
                    hunkA.startLine <= hunkB.endLine &&
                    hunkA.endLine >= hunkB.startLine) {
                    conflicts.push(`${hunkA.file}:${hunkA.startLine}-${hunkA.endLine} (both approaches modify)`);
                    // Favor hunkA (higher-scored worker) for conflicts
                    hasConflict = true;
                    usedB.add(i);
                }
            }
            resultParts.push(hunkA.content);
        }

        // Add non-overlapping hunks from B
        for (let i = 0; i < hunksB.length; i++) {
            if (!usedB.has(i)) {
                resultParts.push(hunksB[i].content);
            }
        }

        return { conflicts, merged: resultParts.join('\n\n') };
    }

    /**
     * Synthesize diffs by respecting hierarchy.
     * Parses unified diff hunks, detects file/line overlaps,
     * and favors the higher-scored worker on conflicts.
     */
    private hierarchicalSynthesize(a: WorkerResult, b: WorkerResult): string {
        if (a.diff === b.diff) return a.diff;
        if (!a.diff || a.diff.trim().length === 0) return b.diff;
        if (!b.diff || b.diff.trim().length === 0) return a.diff;

        const hunksA = this.parseHunks(a.diff);
        const hunksB = this.parseHunks(b.diff);

        // If parsing fails (non-standard diff format), fall back to concatenation
        if (hunksA.length === 0 && hunksB.length === 0) {
            return `// SYNTHESIZED BY NEXUS ORACLE\n// Approach A: ${a.approach}\n// Approach B: ${b.approach}\n\n${a.diff}\n\n${b.diff}`;
        }

        const { conflicts, merged } = this.detectOverlaps(hunksA, hunksB);

        const header = [
            '// SYNTHESIZED BY NEXUS ORACLE',
            `// Approach A (primary): ${a.approach}`,
            `// Approach B (secondary): ${b.approach}`,
            conflicts.length > 0 ? `// ⚠️  ${conflicts.length} conflict(s) resolved — favored Approach A` : '// ✅ No conflicts detected',
        ].join('\n');

        return `${header}\n\n${merged}`;
    }
}
