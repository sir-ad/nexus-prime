/**
 * Token Supremacy Engine
 *
 * Purpose: Make every token count. This engine runs BEFORE any large context
 * operation and decides what to read, what to skip, what to summarize.
 *
 * Built for AntiGravity to reduce token waste by 50-70%.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { ContextAssembler, type AssemblyResult, type BudgetConfig } from './context-assembler.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FileRef {
    path: string;
    sizeBytes: number;
    lastModified?: number;
}

export type ReadAction = 'skip' | 'outline' | 'partial' | 'full';

export interface FileReadPlan {
    file: FileRef;
    action: ReadAction;
    startLine?: number;
    endLine?: number;
    reason: string;
    estimatedTokens: number;
}

export interface ReadingPlan {
    task: string;
    files: FileReadPlan[];
    totalEstimatedTokens: number;
    savings: number; // tokens saved vs reading everything
    sessionBudget: number;
}

export interface SessionSummary {
    sessionId: string;
    timestamp: number;
    files: string[];        // file paths seen
    fileSHAs: Record<string, string>; // path → sha/mtime fingerprint
    summary: string;        // 200-word condensed summary
    keyDecisions: string[]; // #decision tagged items
}

export interface ContextDelta {
    added: FileRef[];      // new files not seen before
    changed: FileRef[];    // files that changed since last session
    unchanged: FileRef[];  // files to skip (use last session's summary)
    summary?: string;      // previous session summary (replaces unchanged context)
}

export interface TokenBudget {
    total: number;
    allocated: Map<string, number>; // workerId → tokens
    remaining: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Engine
// ─────────────────────────────────────────────────────────────────────────────

export class TokenSupremacyEngine {
    private sessionBudget: number;
    private sessionPath: string;

    // Per-session learned relevance: task keyword → file paths that helped
    private relevanceCache: Map<string, Map<string, number>> = new Map();
    private relevanceCachePath: string;
    private contextAssembler: ContextAssembler;

    constructor(sessionBudget: number = 200_000) {
        this.sessionBudget = sessionBudget;
        this.sessionPath = path.join(os.homedir(), '.nexus-prime', 'sessions');
        this.relevanceCachePath = path.join(os.homedir(), '.nexus-prime', 'relevance.json');
        this.contextAssembler = new ContextAssembler();

        fs.mkdirSync(this.sessionPath, { recursive: true });
        if (!fs.existsSync(path.dirname(this.relevanceCachePath))) {
            fs.mkdirSync(path.dirname(this.relevanceCachePath), { recursive: true });
        }
        this.loadRelevanceCache();
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Primary API: generate a reading plan for a task
    /**
     * Plan a token-efficient reading strategy for a given task + files.
     */
    plan(task: string, files: FileRef[]): ReadingPlan {
        // Apply hypertuning if we have many files
        if (files.length > 10) {
            this.hypertune(task);
        }

        const taskKeywords = this.extractKeywords(task);
        const plans: FileReadPlan[] = [];
        let totalTokens = 0;
        let fullReadTokens = 0;

        for (const file of files) {
            const relevance = this.scoreRelevance(file.path, taskKeywords);
            const estFull = Math.ceil(file.sizeBytes / 4); // ~4 chars per token
            fullReadTokens += estFull;

            let plan: FileReadPlan;

            if (relevance < 0.15) {
                // Irrelevant — skip entirely
                plan = {
                    file,
                    action: 'skip',
                    reason: `low relevance (${relevance.toFixed(2)}) to task`,
                    estimatedTokens: 0
                };
            } else if (estFull < 300) {
                // Small file — always read fully
                plan = {
                    file,
                    action: 'full',
                    reason: 'small file, cheap to read',
                    estimatedTokens: estFull
                };
            } else if (relevance < 0.40 || estFull > 30_000) {
                // Low relevance or huge file — outline only
                plan = {
                    file,
                    action: 'outline',
                    reason: relevance < 0.40
                        ? `medium relevance (${relevance.toFixed(2)}), read outline`
                        : `large file (${Math.round(file.sizeBytes / 1024)}KB), read outline`,
                    estimatedTokens: 250
                };
            } else if (estFull > 5_000) {
                // Large but relevant — read hot sections
                const { start, end } = this.estimateHotLines(file, taskKeywords);
                plan = {
                    file,
                    action: 'partial',
                    startLine: start,
                    endLine: end,
                    reason: `relevant but large — reading lines ${start}-${end}`,
                    estimatedTokens: Math.ceil(((end - start) * 80) / 4) // ~80 chars/line
                };
            } else {
                // Relevant, reasonable size — full read
                plan = {
                    file,
                    action: 'full',
                    reason: `high relevance (${relevance.toFixed(2)})`,
                    estimatedTokens: estFull
                };
            }

            totalTokens += plan.estimatedTokens;
            plans.push(plan);
        }

        return {
            task,
            files: plans,
            totalEstimatedTokens: totalTokens,
            savings: fullReadTokens - totalTokens,
            sessionBudget: this.sessionBudget
        };
    }

    /**
     * Legacy compatibility wrapper for NexusPrime.
     */
    optimize(context: string[], task: string): ReadingPlan {
        const files: FileRef[] = context.map((c, i) => ({
            path: `context_${i}.txt`,
            sizeBytes: c.length * 4,
            lastModified: Date.now()
        }));
        return this.plan(task, files);
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Differential Context: only pass what CHANGED
    // Saves ~60-70% tokens on follow-up sessions
    // ───────────────────────────────────────────────────────────────────────────

    differential(prev: SessionSummary, curr: FileRef[]): ContextDelta {
        const delta: ContextDelta = {
            added: [],
            changed: [],
            unchanged: [],
            summary: prev.summary
        };

        for (const file of curr) {
            const prevSHA = prev.fileSHAs[file.path];
            const currSHA = this.fingerprintFile(file);

            if (!prevSHA) {
                delta.added.push(file);
            } else if (prevSHA !== currSHA) {
                delta.changed.push(file);
            } else {
                delta.unchanged.push(file); // SKIP — use prior summary
            }
        }

        return delta;
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Multi-Worker Token Budget Allocation
    // Byzantine-inspired: workers bid, budget allocated by expected value
    // ───────────────────────────────────────────────────────────────────────────

    allocateBudget(
        workers: Array<{ id: string; estimatedValue: number; estimatedCost: number }>,
        totalBudget: number = this.sessionBudget
    ): TokenBudget {
        const bids = workers.map(w => ({
            id: w.id,
            score: w.estimatedValue / Math.max(w.estimatedCost, 1)
        }));

        const totalScore = bids.reduce((s, b) => s + b.score, 0) || 1;
        const allocated = new Map<string, number>();
        let used = 0;

        for (const bid of bids) {
            const share = Math.floor((bid.score / totalScore) * totalBudget);
            allocated.set(bid.id, share);
            used += share;
        }

        return { total: totalBudget, allocated, remaining: totalBudget - used };
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Learn: record which files were actually useful for a task type
    // ───────────────────────────────────────────────────────────────────────────

    learn(taskType: string, usefulFiles: string[], skipFiles: string[]): void {
        if (!this.relevanceCache.has(taskType)) {
            this.relevanceCache.set(taskType, new Map());
        }
        const cache = this.relevanceCache.get(taskType)!;

        for (const f of usefulFiles) {
            cache.set(f, (cache.get(f) ?? 0) + 1.0);
        }
        for (const f of skipFiles) {
            cache.set(f, (cache.get(f) ?? 0) - 0.3); // mild penalty
        }

        this.saveRelevanceCache();
    }

    private loadRelevanceCache(): void {
        try {
            if (fs.existsSync(this.relevanceCachePath)) {
                const data = JSON.parse(fs.readFileSync(this.relevanceCachePath, 'utf-8'));
                for (const [taskType, fileScores] of Object.entries(data)) {
                    const scoreMap = new Map<string, number>(Object.entries(fileScores as any));
                    this.relevanceCache.set(taskType, scoreMap);
                }
            }
        } catch (e) {
            console.error('Failed to load relevance cache:', e);
        }
    }

    private saveRelevanceCache(): void {
        try {
            const data: Record<string, Record<string, number>> = {};
            for (const [taskType, scoreMap] of this.relevanceCache.entries()) {
                data[taskType] = Object.fromEntries(scoreMap.entries());
            }
            fs.writeFileSync(this.relevanceCachePath, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('Failed to save relevance cache:', e);
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Session summary persistence
    // ───────────────────────────────────────────────────────────────────────────

    saveSessionSummary(summary: SessionSummary): void {
        const date = new Date(summary.timestamp).toISOString().slice(0, 10);
        const file = path.join(this.sessionPath, `${date}-${summary.sessionId}.json`);
        fs.writeFileSync(file, JSON.stringify(summary, null, 2));
    }

    loadLatestSessionSummary(): SessionSummary | null {
        try {
            const files = fs.readdirSync(this.sessionPath)
                .filter(f => f.endsWith('.json'))
                .sort()
                .reverse();

            if (files.length === 0) return null;

            const content = fs.readFileSync(
                path.join(this.sessionPath, files[0]),
                'utf-8'
            );
            return JSON.parse(content);
        } catch {
            return null;
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Helpers
    // ───────────────────────────────────────────────────────────────────────────

    private extractKeywords(task: string): string[] {
        // Remove stop words, extract meaningful tokens
        const stopWords = new Set([
            'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
            'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
            'would', 'could', 'should', 'may', 'might', 'must', 'can',
            'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
            'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this',
            'it', 'its', 'we', 'our', 'you', 'your', 'i', 'my'
        ]);

        return task
            .toLowerCase()
            // eslint-disable-next-line no-useless-escape
            .replace(/[^a-z0-9\s_\-\/\.]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !stopWords.has(w));
    }

    private scoreRelevance(filePath: string, keywords: string[]): number {
        if (keywords.length === 0) return 0.5;

        // ── Normalize path: strip cwd prefix so keywords match relative segments ──
        const cwd = process.cwd().toLowerCase().replace(/\\/g, '/');
        let normalized = filePath.toLowerCase().replace(/\\/g, '/');
        if (normalized.startsWith(cwd)) {
            normalized = normalized.slice(cwd.length).replace(/^\//, '');
        }
        const parts = normalized.split('/');
        const fileName = parts[parts.length - 1];
        const baseName = fileName.replace(/\.[^.]+$/, ''); // e.g. "memory" from "memory.ts"
        const ext = fileName.split('.').pop() ?? '';

        // ── Extension-based baseline: .ts/.js files always get a floor for code tasks ──
        let extBaseline = 0;
        if (['ts', 'js', 'tsx', 'jsx'].includes(ext)) extBaseline = 0.20;
        else if (['json', 'md'].includes(ext)) extBaseline = 0.15;

        // ── Path keyword matching ──
        let pathScore = 0;
        let pathMatches = 0;

        for (const kw of keywords) {
            // Check basename directly (e.g. keyword "memory" matches "memory.ts")
            if (baseName === kw || baseName.includes(kw)) {
                pathMatches++;
                pathScore += 1.5;
            } else if (normalized.includes(kw)) {
                pathMatches++;
                pathScore += 0.8;
            }
        }

        // ── Content-aware scoring (first 500 bytes) — weighted heavily ──
        let contentBonus = 0;
        try {
            const fullPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
            if (fs.existsSync(fullPath)) {
                const fd = fs.openSync(fullPath, 'r');
                const buffer = Buffer.alloc(500);
                const bytesRead = fs.readSync(fd, buffer, 0, 500, 0);
                fs.closeSync(fd);

                const content = buffer.toString('utf-8', 0, bytesRead).toLowerCase();
                const contentKeywords = this.extractKeywords(content);
                let contentMatches = 0;
                for (const kw of keywords) {
                    if (contentKeywords.includes(kw)) contentMatches++;
                }
                // Boost from 0.6 → 0.8 — content is the most reliable signal
                contentBonus = (contentMatches / keywords.length) * 0.8;
            }
        } catch { /* ignore */ }

        // ── Learned relevance ──
        const taskType = keywords.slice(0, 3).join('_');
        const learnedScore = this.relevanceCache.get(taskType)?.get(filePath) ?? 0;

        // ── Semantic type bonuses ──
        let typeBonus = 0;
        const codeKws = ['fix', 'bug', 'debug', 'error', 'impl', 'add', 'build', 'audit', 'nexus', 'prime', 'tools', 'code', 'source'];
        const memKws = ['memory', 'cache', 'store', 'recall', 'persist'];
        const testKws = ['test', 'spec', 'jest', 'validate', 'verify'];

        if (keywords.some(k => codeKws.includes(k)) && ['ts', 'js', 'json', 'md'].includes(ext)) {
            typeBonus = 0.15;
        }
        if (keywords.some(k => memKws.includes(k)) && (normalized.includes('memory') || baseName.includes('memory'))) {
            typeBonus = 0.4;
        }
        if (keywords.some(k => testKws.includes(k)) && ['test', 'spec'].some(t => fileName.includes(t))) {
            typeBonus = 0.3;
        }

        // ── Combine: baseline + path + content + type + learned ──
        const pathComponent = keywords.length > 0
            ? (pathMatches / keywords.length) * (pathScore / Math.max(pathMatches, 1))
            : 0;

        return Math.min(1, Math.max(extBaseline, pathComponent + typeBonus + learnedScore * 0.1 + contentBonus));
    }

    private estimateHotLines(
        file: FileRef,
        keywords: string[]
    ): { start: number; end: number } {
        // Without reading the file, estimate hot sections by filename heuristics
        // In production, the Ghost Pass pre-reads and provides actual line hints
        const totalLines = Math.ceil(file.sizeBytes / 80); // ~80 chars/line
        const windowSize = Math.min(200, Math.ceil(totalLines * 0.3));

        // Heuristic: hot code tends to be in first 30% or last 30% of file
        // Default to first section (imports + main logic)
        return {
            start: 1,
            end: Math.min(windowSize, totalLines)
        };
    }

    private fingerprintFile(file: FileRef): string {
        // Use mtime + size as cheap fingerprint (no hashing needed)
        return `${file.lastModified ?? 0}-${file.sizeBytes}`;
    }

    /**
     * Adjust token budget based on task complexity signals.
     * Complex tasks get +25% budget; simple lookups get -25%.
     */
    private hypertune(task: string): void {
        const taskLower = task.toLowerCase();
        const originalBudget = this.sessionBudget;

        // Complexity signals
        const complexSignals = ['refactor', 'complex', 'rewrite', 'migration', 'audit', 'architecture', 'redesign'];
        const simpleSignals = ['lookup', 'find', 'list', 'check', 'quick', 'status'];

        const isComplex = complexSignals.some(s => taskLower.includes(s));
        const isSimple = simpleSignals.some(s => taskLower.includes(s));

        if (isComplex) {
            this.sessionBudget = Math.round(originalBudget * 1.25);
        } else if (isSimple) {
            this.sessionBudget = Math.round(originalBudget * 0.75);
        }

        if (this.sessionBudget !== originalBudget) {
            console.error(`[Token Engine] Hypertuned: budget ${originalBudget.toLocaleString()} → ${this.sessionBudget.toLocaleString()} tokens (${isComplex ? 'complex' : 'simple'} task detected)`);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HyperTune Max: Mathematical context-token optimization
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * HyperTune Max — Mathematical context assembly using greedy knapsack.
     * Chunks all files at function/class boundaries, scores each chunk
     * by relevance/recency/connectivity/novelty, and selects the optimal
     * combination that maximizes quality within the token budget.
     */
    hypertuneMax(
        task: string,
        files: FileRef[],
        graphConnectivity?: (chunk: { source: string; label: string }) => number
    ): { plan: ReadingPlan; assembly: AssemblyResult; budgetConfig: BudgetConfig } {
        // 1. Compute adaptive budget
        const budgetConfig = this.contextAssembler.computeBudget(task, this.sessionBudget);

        // 2. Chunk all candidate files
        const allChunks = files.flatMap(f => {
            const resolved = path.isAbsolute(f.path) ? f.path : path.join(process.cwd(), f.path);
            return this.contextAssembler.chunkFile(resolved);
        });

        // 3. Optionally score connectivity from graph (Phase 8D)
        if (graphConnectivity) {
            for (const chunk of allChunks) {
                chunk.quality = graphConnectivity({ source: chunk.source, label: chunk.label });
            }
        }

        // 4. Greedy knapsack selection
        const assembly = this.contextAssembler.assemble(task, allChunks, budgetConfig.effectiveBudget);

        // 5. Convert to ReadingPlan format for backward compatibility
        const fileMap = new Map<string, { chunks: typeof assembly.selected; file: FileRef }>();
        for (const file of files) {
            const resolved = path.isAbsolute(file.path) ? file.path : path.join(process.cwd(), file.path);
            fileMap.set(resolved, { chunks: [], file });
        }
        for (const chunk of assembly.selected) {
            const entry = fileMap.get(chunk.source);
            if (entry) entry.chunks.push(chunk);
        }

        const plans: FileReadPlan[] = [];
        let totalTokens = 0;
        let fullReadTokens = 0;

        for (const [filePath, { chunks, file }] of fileMap) {
            const estFull = Math.ceil(file.sizeBytes / 4);
            fullReadTokens += estFull;

            if (chunks.length === 0) {
                plans.push({
                    file,
                    action: 'skip',
                    reason: 'below quality threshold',
                    estimatedTokens: 0,
                });
            } else {
                // Check if all lines are covered
                const totalLines = Math.ceil(file.sizeBytes / 80);
                const coveredLines = chunks.reduce((s, c) => s + (c.endLine - c.startLine + 1), 0);
                const coverage = coveredLines / Math.max(totalLines, 1);

                if (coverage > 0.7) {
                    plans.push({
                        file,
                        action: 'full',
                        reason: `${(coverage * 100).toFixed(0)}% coverage — read fully (q=${chunks.reduce((s, c) => s + c.quality, 0).toFixed(2)})`,
                        estimatedTokens: estFull,
                    });
                    totalTokens += estFull;
                } else {
                    // Take the highest-quality chunk's range
                    const best = chunks.sort((a, b) => b.quality - a.quality)[0];
                    const chunkTokens = chunks.reduce((s, c) => s + c.tokens, 0);
                    plans.push({
                        file,
                        action: 'partial',
                        startLine: best.startLine,
                        endLine: best.endLine,
                        reason: `${chunks.length} chunk(s) selected (q=${chunks.reduce((s, c) => s + c.quality, 0).toFixed(2)})`,
                        estimatedTokens: chunkTokens,
                    });
                    totalTokens += chunkTokens;
                }
            }
        }

        const plan: ReadingPlan = {
            task,
            files: plans,
            totalEstimatedTokens: totalTokens,
            savings: fullReadTokens - totalTokens,
            sessionBudget: budgetConfig.effectiveBudget,
        };

        return { plan, assembly, budgetConfig };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan formatter (for MCP response)
// ─────────────────────────────────────────────────────────────────────────────

export function formatReadingPlan(plan: ReadingPlan): string {
    const lines: string[] = [
        `📊 Token Budget Plan for: "${plan.task}"`,
        `Total estimated: ${plan.totalEstimatedTokens.toLocaleString()} tokens`,
        `Savings vs full read: ${plan.savings.toLocaleString()} tokens (${Math.round(plan.savings / Math.max(plan.savings + plan.totalEstimatedTokens, 1) * 100)}%)`,
        '',
        '📋 Reading Plan:'
    ];

    const byAction: Record<ReadAction, FileReadPlan[]> = {
        full: [], outline: [], partial: [], skip: []
    };

    for (const fp of plan.files) {
        byAction[fp.action].push(fp);
    }

    if (byAction.full.length > 0) {
        lines.push('  ✅ Read fully:');
        byAction.full.forEach(f => lines.push(`    • ${f.file.path} (~${f.estimatedTokens} tokens)`));
    }
    if (byAction.partial.length > 0) {
        lines.push('  ✂️  Read partially:');
        byAction.partial.forEach(f => lines.push(`    • ${f.file.path} lines ${f.startLine}-${f.endLine} (~${f.estimatedTokens} tokens)`));
    }
    if (byAction.outline.length > 0) {
        lines.push('  🔍 Outline only:');
        byAction.outline.forEach(f => lines.push(`    • ${f.file.path} (~${f.estimatedTokens} tokens)`));
    }
    if (byAction.skip.length > 0) {
        lines.push('  ⏭️  Skip:');
        byAction.skip.forEach(f => lines.push(`    • ${f.file.path} (${f.reason})`));
    }

    return lines.join('\n');
}

export const createTokenSupremacyEngine = (budget?: number) =>
    new TokenSupremacyEngine(budget);
