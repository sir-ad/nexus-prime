import { MemoryEngine, MemoryItem } from '../engines/memory.js';
import { MergeDecision } from '../phantom/index.js';

/**
 * AgentLearner — Post-execution analysis engine.
 * Identifies patterns of success/failure and marks evolution candidates.
 * Uses direct SQL queries via MemoryEngine.queryByTags for precision.
 */
export class AgentLearner {
    constructor(private memory: MemoryEngine) { }

    /**
     * Analyze a swarm execution result and store findings.
     */
    async analyze(goal: string, decision: MergeDecision): Promise<void> {
        const isSuccess = decision.confidence > 0.7 && decision.conflicts.length === 0;
        const priority = isSuccess ? 0.6 : 0.9;
        const tags = ['#agent-learning', '#swarm-analysis'];

        if (!isSuccess) {
            tags.push('#evolution-candidate');
        }

        const summary = [
            `Swarm Result Analysis: goal="${goal.slice(0, 50)}..."`,
            `Status: ${isSuccess ? 'SUCCESS' : 'DIVERGED'}`,
            `Confidence: ${decision.confidence.toFixed(2)}`,
            `Conflicts: ${decision.conflicts.length}`,
            `Strategy: ${decision.recommendedStrategy}`,
            `Learnings: ${decision.learnings.length} items captured`
        ].join('\n');

        await this.memory.store(summary, priority, tags);

        // If there were conflicts, store them specifically as evolution points
        if (decision.conflicts.length > 0) {
            for (const conflict of decision.conflicts) {
                await this.memory.store(
                    `Evolution Point: Conflict in ${conflict} during goal: ${goal}`,
                    0.85,
                    ['#evolution-candidate', '#conflict-pattern']
                );
            }
        }
    }

    /**
     * Identify evolution candidates using direct SQL tag queries.
     * Groups findings by file path to identify hotspots.
     */
    async identifyEvolutionCandidates(): Promise<{
        candidates: MemoryItem[];
        hotspots: Map<string, number>;
        recommendations: string[];
    }> {
        const candidates = this.memory.queryByTags(['#evolution-candidate'], 30);

        // Group by file path to identify hotspots
        const hotspots = new Map<string, number>();
        const filePattern = /(?:in|file:?)\s+([^\s,]+\.[jt]sx?)/gi;

        for (const item of candidates) {
            let match: RegExpExecArray | null;
            while ((match = filePattern.exec(item.content)) !== null) {
                const file = match[1];
                hotspots.set(file, (hotspots.get(file) ?? 0) + 1);
            }
        }

        // Generate actionable recommendations
        const recommendations: string[] = [];

        // Files with 3+ conflicts are high-priority refactor targets
        for (const [file, count] of hotspots.entries()) {
            if (count >= 3) {
                recommendations.push(`🔴 High-priority refactor: ${file} (${count} conflict occurrences)`);
            } else if (count >= 2) {
                recommendations.push(`🟡 Monitor: ${file} (${count} conflict occurrences)`);
            }
        }

        // Divergence patterns
        const diverged = candidates.filter(c => c.content.includes('DIVERGED'));
        if (diverged.length > 3) {
            recommendations.push(`⚠️ Swarm divergence rate is high (${diverged.length} episodes). Consider tighter task decomposition.`);
        }

        // Confidence trend
        const confidences = candidates
            .map(c => {
                const m = c.content.match(/Confidence:\s*([\d.]+)/);
                return m ? parseFloat(m[1]) : null;
            })
            .filter((c): c is number => c !== null);

        if (confidences.length > 0) {
            const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
            if (avg < 0.5) {
                recommendations.push(`📉 Average swarm confidence is low (${avg.toFixed(2)}). Tasks may be too broad.`);
            }
        }

        if (recommendations.length === 0 && candidates.length === 0) {
            recommendations.push('✅ No evolution candidates found — agents are performing well.');
        }

        return { candidates, hotspots, recommendations };
    }
}
