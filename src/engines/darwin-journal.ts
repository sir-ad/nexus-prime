/**
 * Nexus Prime - Darwin Journal
 *
 * Structured improvement log for the Darwin Loop self-improvement orchestrator.
 * Maintains state of hypotheses, validation gates, and outcomes.
 *
 * Phase: 8F (Darwin Loop)
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DarwinCycle {
    id: string;
    hypothesis: string;
    targetFile: string;
    approach: string;

    // Execution
    worktreeBranch: string;
    diffGenerated: string;

    // Validation
    buildPassed: boolean;
    testsPassed: boolean;
    metricsBefore: Record<string, number>;
    metricsAfter: Record<string, number>;
    guardrailResult: { passed: boolean; score: number };

    // Outcome
    outcome: 'pending' | 'applied' | 'rejected' | 'deferred';
    learnings: string[];
    timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Darwin Journal Manager
// ─────────────────────────────────────────────────────────────────────────────

export class DarwinJournal {
    private readonly journalPath: string;

    constructor() {
        const nexusDir = path.join(os.homedir(), '.nexus-prime');
        fs.mkdirSync(nexusDir, { recursive: true });
        this.journalPath = path.join(nexusDir, 'darwin-journal.json');

        if (!fs.existsSync(this.journalPath)) {
            fs.writeFileSync(this.journalPath, JSON.stringify([], null, 2), 'utf-8');
        }
    }

    /** Load all recorded cycles */
    loadCycles(): DarwinCycle[] {
        try {
            const raw = fs.readFileSync(this.journalPath, 'utf-8');
            return JSON.parse(raw);
        } catch {
            return [];
        }
    }

    /** Save cycles back to disk */
    private saveCycles(cycles: DarwinCycle[]): void {
        fs.writeFileSync(this.journalPath, JSON.stringify(cycles, null, 2), 'utf-8');
    }

    /** Create a new cycle proposal */
    propose(hypothesis: string, targetFile: string, approach: string): DarwinCycle {
        const cycle: DarwinCycle = {
            id: `darwin_${randomUUID()}`,
            hypothesis,
            targetFile,
            approach,
            worktreeBranch: `darwin-${Date.now()}`,
            diffGenerated: '',
            buildPassed: false,
            testsPassed: false,
            metricsBefore: {},
            metricsAfter: {},
            guardrailResult: { passed: false, score: 0 },
            outcome: 'pending',
            learnings: [],
            timestamp: Date.now()
        };

        const cycles = this.loadCycles();
        cycles.push(cycle);
        this.saveCycles(cycles);

        return cycle;
    }

    /** Update an existing cycle */
    updateCycle(id: string, updates: Partial<DarwinCycle>): DarwinCycle | null {
        const cycles = this.loadCycles();
        const idx = cycles.findIndex(c => c.id === id);
        if (idx === -1) return null;

        cycles[idx] = { ...cycles[idx], ...updates };
        this.saveCycles(cycles);

        return cycles[idx];
    }

    /** Get a specific cycle by ID */
    getCycle(id: string): DarwinCycle | null {
        return this.loadCycles().find(c => c.id === id) || null;
    }

    /** Get pending cycles requiring review */
    getPending(): DarwinCycle[] {
        return this.loadCycles().filter(c => c.outcome === 'pending');
    }
}
