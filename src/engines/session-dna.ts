/**
 * Session DNA Manager
 *
 * Generates structured "Session DNA" snapshots that capture the full context
 * of a session — files accessed, decisions made, skills used, and recommended
 * next steps. This enables near-perfect context handover between sessions.
 *
 * Storage: ~/.nexus-prime/sessions/{sessionId}.json
 * Phase: 8A (no dependencies)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionDecision {
    description: string;
    rationale: string;
    confidence: number;
}

export interface SessionDNA {
    sessionId: string;
    timestamp: number;
    duration: number;           // seconds

    // Context snapshot
    filesAccessed: string[];    // ordered by frequency
    filesModified: string[];

    // Knowledge state
    memoriesStored: number;
    memoriesRecalled: number;
    topEntities: string[];      // most-referenced entities

    // Decisions
    decisions: SessionDecision[];

    // Skills
    skillsActivated: string[];
    skillsLearned: string[];

    // Handover
    openQuestions: string[];
    nextSteps: string[];
    handoverScore: number;      // 0.0-1.0
}

// ─────────────────────────────────────────────────────────────────────────────
// Session DNA Manager
// ─────────────────────────────────────────────────────────────────────────────

export class SessionDNAManager {
    private sessionsDir: string;
    private sessionId: string;
    private startTime: number;

    // Accumulators — fed by external calls during the session
    private filesAccessedMap: Map<string, number> = new Map(); // path → access count
    private filesModifiedSet: Set<string> = new Set();
    private decisions: SessionDecision[] = [];
    private skillsActivated: Set<string> = new Set();
    private skillsLearned: Set<string> = new Set();
    private openQuestions: string[] = [];
    private nextSteps: string[] = [];
    private entitiesMap: Map<string, number> = new Map(); // entity → mention count

    // Counters (may be overridden by telemetry at flush time)
    private memoriesStored = 0;
    private memoriesRecalled = 0;
    private totalToolCalls = 0;

    constructor(sessionId: string, sessionsDir?: string) {
        this.sessionId = sessionId;
        this.startTime = Date.now();
        this.sessionsDir = sessionsDir ?? path.join(os.homedir(), '.nexus-prime', 'sessions');
        fs.mkdirSync(this.sessionsDir, { recursive: true });
    }

    getSessionId(): string {
        return this.sessionId;
    }

    // ── Accumulation API ───────────────────────────────────────────────────

    /** Record a file being read/accessed */
    recordFileAccess(filePath: string): void {
        const count = this.filesAccessedMap.get(filePath) ?? 0;
        this.filesAccessedMap.set(filePath, count + 1);
    }

    /** Record a file being modified */
    recordFileModified(filePath: string): void {
        this.filesModifiedSet.add(filePath);
    }

    /** Record a decision made during the session */
    recordDecision(description: string, rationale: string, confidence: number = 0.8): void {
        this.decisions.push({ description, rationale, confidence });
    }

    /** Record a skill being activated */
    recordSkill(skillName: string): void {
        this.skillsActivated.add(skillName);
    }

    /** Record a skill learned during the session */
    recordSkillLearned(skillName: string): void {
        this.skillsLearned.add(skillName);
    }

    /** Record an entity being referenced */
    recordEntity(entity: string): void {
        const count = this.entitiesMap.get(entity) ?? 0;
        this.entitiesMap.set(entity, count + 1);
    }

    /** Record a tool call (for handover score) */
    recordToolCall(): void {
        this.totalToolCalls++;
    }

    /** Record a memory store event */
    recordMemoryStore(): void {
        this.memoriesStored++;
    }

    /** Record a memory recall event */
    recordMemoryRecall(): void {
        this.memoriesRecalled++;
    }

    /** Add an open question for the next session */
    addOpenQuestion(question: string): void {
        this.openQuestions.push(question);
    }

    /** Add a recommended next step */
    addNextStep(step: string): void {
        this.nextSteps.push(step);
    }

    // ── Bulk update from telemetry ─────────────────────────────────────────

    /** Sync counters from SessionTelemetry at flush time */
    syncFromTelemetry(telemetry: {
        callCount: number;
        memoriesStored: number;
        memoriesRecalled: number;
    }): void {
        this.totalToolCalls = Math.max(this.totalToolCalls, telemetry.callCount);
        this.memoriesStored = Math.max(this.memoriesStored, telemetry.memoriesStored);
        this.memoriesRecalled = Math.max(this.memoriesRecalled, telemetry.memoriesRecalled);
    }

    // ── Generation ─────────────────────────────────────────────────────────

    /** Generate the SessionDNA snapshot */
    generate(): SessionDNA {
        const duration = Math.round((Date.now() - this.startTime) / 1000);

        // Sort files by access frequency (most accessed first)
        const filesAccessed = [...this.filesAccessedMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([filePath]) => filePath);

        // Top entities by mention count (max 10)
        const topEntities = [...this.entitiesMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([entity]) => entity);

        // Handover score: (memoriesStored + decisions.length) / totalToolCalls
        const numerator = this.memoriesStored + this.decisions.length;
        const handoverScore = this.totalToolCalls > 0
            ? Math.min(1.0, numerator / this.totalToolCalls)
            : 0.0;

        return {
            sessionId: this.sessionId,
            timestamp: Date.now(),
            duration,
            filesAccessed,
            filesModified: [...this.filesModifiedSet],
            memoriesStored: this.memoriesStored,
            memoriesRecalled: this.memoriesRecalled,
            topEntities,
            decisions: this.decisions,
            skillsActivated: [...this.skillsActivated],
            skillsLearned: [...this.skillsLearned],
            openQuestions: this.openQuestions,
            nextSteps: this.nextSteps,
            handoverScore,
        };
    }

    // ── Persistence ────────────────────────────────────────────────────────

    /** Save the current SessionDNA to disk */
    flush(): SessionDNA {
        const dna = this.generate();
        const filePath = path.join(this.sessionsDir, `${this.sessionId}.json`);
        fs.writeFileSync(filePath, JSON.stringify(dna, null, 2));
        return dna;
    }

    /** Load the most recent SessionDNA from disk */
    static loadLatest(sessionsDir?: string): SessionDNA | null {
        const dir = sessionsDir ?? path.join(os.homedir(), '.nexus-prime', 'sessions');
        if (!fs.existsSync(dir)) return null;

        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .map(f => ({
                name: f,
                mtime: fs.statSync(path.join(dir, f)).mtimeMs,
            }))
            .sort((a, b) => b.mtime - a.mtime);

        if (files.length === 0) return null;

        try {
            const raw = fs.readFileSync(path.join(dir, files[0].name), 'utf-8');
            return JSON.parse(raw) as SessionDNA;
        } catch {
            return null;
        }
    }

    /** Load a specific session by ID */
    static loadById(sessionId: string, sessionsDir?: string): SessionDNA | null {
        const dir = sessionsDir ?? path.join(os.homedir(), '.nexus-prime', 'sessions');
        const filePath = path.join(dir, `${sessionId}.json`);
        if (!fs.existsSync(filePath)) return null;

        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(raw) as SessionDNA;
        } catch {
            return null;
        }
    }

    // ── Formatting ─────────────────────────────────────────────────────────

    /** Format SessionDNA for MCP response */
    static format(dna: SessionDNA): string {
        const lines: string[] = [
            `📊 Session DNA: ${dna.sessionId.slice(0, 8)}`,
            `Duration: ${formatDuration(dna.duration)} │ Handover Score: ${(dna.handoverScore * 100).toFixed(0)}%`,
            '',
        ];

        if (dna.filesModified.length > 0) {
            lines.push(`📝 Files Modified: ${dna.filesModified.length}`);
            for (const f of dna.filesModified.slice(0, 5)) {
                lines.push(`  • ${path.basename(f)}`);
            }
            if (dna.filesModified.length > 5) {
                lines.push(`  ... and ${dna.filesModified.length - 5} more`);
            }
            lines.push('');
        }

        if (dna.filesAccessed.length > 0) {
            lines.push(`👁️ Top Files Accessed: ${Math.min(dna.filesAccessed.length, 5)}`);
            for (const f of dna.filesAccessed.slice(0, 5)) {
                lines.push(`  • ${path.basename(f)}`);
            }
            lines.push('');
        }

        lines.push(`🧠 Memory: ${dna.memoriesStored} stored, ${dna.memoriesRecalled} recalled`);

        if (dna.decisions.length > 0) {
            lines.push('');
            lines.push(`📌 Decisions Made: ${dna.decisions.length}`);
            for (const d of dna.decisions.slice(0, 3)) {
                lines.push(`  • ${d.description} (confidence: ${(d.confidence * 100).toFixed(0)}%)`);
            }
        }

        if (dna.topEntities.length > 0) {
            lines.push('');
            lines.push(`🔗 Top Entities: ${dna.topEntities.slice(0, 5).join(', ')}`);
        }

        if (dna.nextSteps.length > 0) {
            lines.push('');
            lines.push('➡️ Recommended Next Steps:');
            for (const step of dna.nextSteps.slice(0, 5)) {
                lines.push(`  ${step}`);
            }
        }

        if (dna.openQuestions.length > 0) {
            lines.push('');
            lines.push('❓ Open Questions:');
            for (const q of dna.openQuestions.slice(0, 3)) {
                lines.push(`  ${q}`);
            }
        }

        return lines.join('\n');
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
}
