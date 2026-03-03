/**
 * Nexus Prime - Darwin Loop Orchestrator
 *
 * Enforces controlled self-improvement via bounded modification spaces.
 * Ensures proposed hypotheses target allowed directories before logging them.
 *
 * Phase: 8F (Darwin Loop)
 */

import * as path from 'path';
import { DarwinJournal, type DarwinCycle } from './darwin-journal.js';

// ─────────────────────────────────────────────────────────────────────────────
// Bounded Improvement Space Config
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_PATHS = [
    'src/engines/',
    'src/phantom/'
];

const FORBIDDEN_PATHS = [
    'src/agents/adapters/mcp.ts',
    'src/cli.ts',
    'src/index.ts',
    'package.json',
    'tsconfig.json'
];

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export class DarwinLoop {
    public journal: DarwinJournal;

    constructor() {
        this.journal = new DarwinJournal();
    }

    /**
     * Determine if a target file is within the bounded improvement space.
     */
    isAllowedTarget(targetFile: string): { allowed: boolean; reason?: string } {
        // Normalize path separators
        const normalized = targetFile.replace(/\\/g, '/');

        // Check forbidden explicitly
        for (const f of FORBIDDEN_PATHS) {
            if (normalized === f || normalized.endsWith(`/${f}`)) {
                return { allowed: false, reason: `Path explicitly forbidden by core safety bounds: ${f}` };
            }
        }

        // Check allowed prefixes
        for (const a of ALLOWED_PATHS) {
            if (normalized.includes(a)) {
                return { allowed: true };
            }
        }

        return { allowed: false, reason: 'Path is outside of ALLOWED structural bounds (must be engines/ or phantom/)' };
    }

    /**
     * Propose an improvement hypothesis if bounds check passes.
     */
    propose(hypothesis: string, targetFile: string, approach: string): DarwinCycle {
        const boundsCheck = this.isAllowedTarget(targetFile);
        if (!boundsCheck.allowed) {
            throw new Error(`[Darwin Loop Rejected Proposal]: ${boundsCheck.reason}`);
        }

        // Forward to journal
        return this.journal.propose(hypothesis, targetFile, approach);
    }

    /**
     * Review a pending cycle. (In MVP, tests/builds would be validated externally or via PhantomWorker scripts)
     */
    review(cycleId: string, action: 'apply' | 'reject' | 'defer', learnings: string[] = []): DarwinCycle {
        const cycle = this.journal.getCycle(cycleId);
        if (!cycle) {
            throw new Error(`Darwin Cycle ${cycleId} not found.`);
        }

        if (cycle.outcome !== 'pending') {
            throw new Error(`Darwin Cycle ${cycleId} is already ${cycle.outcome}.`);
        }

        // Update state
        const outcomeMap: Record<string, DarwinCycle['outcome']> = {
            'apply': 'applied',
            'reject': 'rejected',
            'defer': 'deferred'
        };

        const updated = this.journal.updateCycle(cycleId, {
            outcome: outcomeMap[action],
            learnings
        });

        return updated!;
    }

    /**
     * Get pending cycles
     */
    getPending(): DarwinCycle[] {
        return this.journal.getPending();
    }
}
