/**
 * Context Assembler
 *
 * Mathematical context-token optimization engine.
 * Replaces heuristic file selection with a quality-scored greedy knapsack.
 *
 * Quality = w1 * relevance + w2 * recency + w3 * connectivity + w4 * novelty
 * Maximize Σ(quality_i) subject to Σ(tokens_i) ≤ budget
 *
 * Phase: 8B (depends on 8A Session DNA)
 */

import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ContextChunk {
    source: string;        // file path
    content: string;       // chunk text
    tokens: number;        // estimated token count
    quality: number;       // computed score (0.0 - 1.0)
    label: string;         // human-readable label (e.g. "MyClass.method()")
    startLine: number;
    endLine: number;
}

export interface QualityWeights {
    relevance: number;     // w1 — cosine similarity to task
    recency: number;       // w2 — time decay factor
    connectivity: number;  // w3 — graph centrality (0.0 if no graph)
    novelty: number;       // w4 — not seen in current session
}

export interface AssemblyResult {
    selected: ContextChunk[];
    totalQuality: number;
    totalTokens: number;
    budget: number;
    efficiency: number;    // quality per token
    rejectedCount: number;
}

export interface BudgetConfig {
    base: number;
    taskMultiplier: number;
    effectiveBudget: number;
    reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Assembler
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: QualityWeights = {
    relevance: 0.45,
    recency: 0.20,
    connectivity: 0.10,
    novelty: 0.25,
};

export class ContextAssembler {
    private weights: QualityWeights;
    private seenChunks: Set<string> = new Set(); // tracks chunks seen in session

    constructor(weights?: Partial<QualityWeights>) {
        this.weights = { ...DEFAULT_WEIGHTS, ...weights };
    }

    // ── Greedy Knapsack ────────────────────────────────────────────────────

    /**
     * Maximize Σ(quality_i) subject to Σ(tokens_i) ≤ budget
     * Solved via greedy knapsack: sort by quality/token ratio descending.
     */
    assemble(task: string, candidates: ContextChunk[], budget: number): AssemblyResult {
        // Score all candidates
        const scored = candidates.map(chunk => ({
            ...chunk,
            quality: this.scoreChunk(chunk, task),
        }));

        // Sort by quality-per-token ratio (descending) — greedy knapsack
        scored.sort((a, b) => {
            const ratioA = a.tokens > 0 ? a.quality / a.tokens : 0;
            const ratioB = b.tokens > 0 ? b.quality / b.tokens : 0;
            return ratioB - ratioA;
        });

        // Greedy selection
        const selected: ContextChunk[] = [];
        let totalTokens = 0;
        let totalQuality = 0;
        let rejected = 0;

        for (const chunk of scored) {
            if (chunk.quality <= 0.05) {
                rejected++;
                continue; // Skip near-zero quality chunks
            }
            if (totalTokens + chunk.tokens <= budget) {
                selected.push(chunk);
                totalTokens += chunk.tokens;
                totalQuality += chunk.quality;
                this.seenChunks.add(this.chunkKey(chunk));
            } else {
                rejected++;
            }
        }

        return {
            selected,
            totalQuality,
            totalTokens,
            budget,
            efficiency: totalTokens > 0 ? totalQuality / totalTokens : 0,
            rejectedCount: rejected,
        };
    }

    // ── Quality Scoring ────────────────────────────────────────────────────

    /**
     * Compute quality score for a chunk:
     * quality = w1*relevance + w2*recency + w3*connectivity + w4*novelty
     */
    scoreChunk(chunk: ContextChunk, task: string): number {
        const rel = this.scoreRelevance(chunk, task);
        const rec = this.scoreRecency(chunk);
        const con = chunk.quality; // Use pre-set connectivity if available (0.0 fallback)
        const nov = this.scoreNovelty(chunk);

        return (
            this.weights.relevance * rel +
            this.weights.recency * rec +
            this.weights.connectivity * con +
            this.weights.novelty * nov
        );
    }

    /** Relevance: keyword overlap between chunk content and task */
    private scoreRelevance(chunk: ContextChunk, task: string): number {
        const taskTokens = this.tokenize(task);
        const chunkTokens = this.tokenize(chunk.content.slice(0, 2000)); // cap for perf

        if (taskTokens.length === 0 || chunkTokens.length === 0) return 0.3;

        // Jaccard-like overlap
        const taskSet = new Set(taskTokens);
        const chunkSet = new Set(chunkTokens);
        let overlap = 0;
        for (const t of taskSet) {
            if (chunkSet.has(t)) overlap++;
        }

        // Also boost if source file path contains task keywords
        const pathLower = chunk.source.toLowerCase();
        let pathBoost = 0;
        for (const t of taskSet) {
            if (pathLower.includes(t)) pathBoost += 0.15;
        }

        const jaccardScore = overlap / (taskSet.size + chunkSet.size - overlap);
        return Math.min(1.0, jaccardScore * 3 + Math.min(pathBoost, 0.4));
    }

    /** Recency: how recently the file was modified (exponential decay) */
    private scoreRecency(chunk: ContextChunk): number {
        try {
            const stat = fs.statSync(chunk.source);
            const ageHours = (Date.now() - stat.mtimeMs) / 3_600_000;
            // Exponential decay: half-life of 24 hours
            return Math.exp(-0.693 * ageHours / 24);
        } catch {
            return 0.3; // default for unresolvable files
        }
    }

    /** Novelty: chunks not yet seen in this session score higher */
    private scoreNovelty(chunk: ContextChunk): number {
        return this.seenChunks.has(this.chunkKey(chunk)) ? 0.1 : 1.0;
    }

    // ── Adaptive Budget ────────────────────────────────────────────────────

    /**
     * Compute adaptive budget: simple tasks -25%, complex tasks +50%
     */
    computeBudget(task: string, baseBudget: number): BudgetConfig {
        const taskLower = task.toLowerCase();

        const complexSignals = [
            'refactor', 'rewrite', 'migrate', 'architect', 'redesign',
            'audit', 'complex', 'overhaul', 'multi-file', 'interrelated',
        ];
        const simpleSignals = [
            'lookup', 'find', 'check', 'status', 'quick', 'list', 'read',
        ];

        const complexCount = complexSignals.filter(s => taskLower.includes(s)).length;
        const simpleCount = simpleSignals.filter(s => taskLower.includes(s)).length;

        let multiplier = 1.0;
        let reason = 'standard complexity';

        if (complexCount >= 2) {
            multiplier = 1.50;
            reason = `high complexity (${complexCount} signals: ${complexSignals.filter(s => taskLower.includes(s)).join(', ')})`;
        } else if (complexCount === 1) {
            multiplier = 1.25;
            reason = `moderate complexity (${complexSignals.find(s => taskLower.includes(s))})`;
        } else if (simpleCount >= 2) {
            multiplier = 0.60;
            reason = `simple task (${simpleCount} signals)`;
        } else if (simpleCount === 1) {
            multiplier = 0.75;
            reason = `light task (${simpleSignals.find(s => taskLower.includes(s))})`;
        }

        return {
            base: baseBudget,
            taskMultiplier: multiplier,
            effectiveBudget: Math.round(baseBudget * multiplier),
            reason,
        };
    }

    // ── Semantic Chunking ──────────────────────────────────────────────────

    /**
     * Split a file into semantic chunks at function/class boundaries.
     * Falls back to line-based chunking if parsing fails.
     */
    chunkFile(filepath: string): ContextChunk[] {
        const resolved = path.isAbsolute(filepath) ? filepath : path.join(process.cwd(), filepath);

        let content: string;
        try {
            content = fs.readFileSync(resolved, 'utf-8');
        } catch {
            return [];
        }

        const lines = content.split('\n');

        // For small files (< 100 lines), return as single chunk
        if (lines.length < 100) {
            return [{
                source: resolved,
                content,
                tokens: Math.ceil(content.length / 4),
                quality: 0, // will be scored later
                label: path.basename(filepath),
                startLine: 1,
                endLine: lines.length,
            }];
        }

        // Detect function/class boundaries for .ts/.js files
        const ext = path.extname(filepath).toLowerCase();
        if (['.ts', '.js', '.tsx', '.jsx'].includes(ext)) {
            return this.chunkByBoundaries(resolved, lines);
        }

        // For other files, chunk by fixed window
        return this.chunkByWindow(resolved, lines, 80);
    }

    /** Chunk TypeScript/JavaScript by function and class boundaries */
    private chunkByBoundaries(filepath: string, lines: string[]): ContextChunk[] {
        const chunks: ContextChunk[] = [];
        const boundaryPattern = /^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|enum|abstract)\s+(\w+)/;

        let currentStart = 0;
        let currentLabel = path.basename(filepath) + ':top';

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(boundaryPattern);
            if (match && i > currentStart + 3) {
                // Close previous chunk
                const chunkContent = lines.slice(currentStart, i).join('\n');
                if (chunkContent.trim().length > 0) {
                    chunks.push({
                        source: filepath,
                        content: chunkContent,
                        tokens: Math.ceil(chunkContent.length / 4),
                        quality: 0,
                        label: currentLabel,
                        startLine: currentStart + 1,
                        endLine: i,
                    });
                }
                currentStart = i;
                currentLabel = match[1];
            }
        }

        // Close last chunk
        const lastContent = lines.slice(currentStart).join('\n');
        if (lastContent.trim().length > 0) {
            chunks.push({
                source: filepath,
                content: lastContent,
                tokens: Math.ceil(lastContent.length / 4),
                quality: 0,
                label: currentLabel,
                startLine: currentStart + 1,
                endLine: lines.length,
            });
        }

        return chunks;
    }

    /** Chunk by fixed-size window (for non-JS/TS files) */
    private chunkByWindow(filepath: string, lines: string[], windowSize: number): ContextChunk[] {
        const chunks: ContextChunk[] = [];
        for (let i = 0; i < lines.length; i += windowSize) {
            const end = Math.min(i + windowSize, lines.length);
            const chunkContent = lines.slice(i, end).join('\n');
            if (chunkContent.trim().length > 0) {
                chunks.push({
                    source: filepath,
                    content: chunkContent,
                    tokens: Math.ceil(chunkContent.length / 4),
                    quality: 0,
                    label: `${path.basename(filepath)}:${i + 1}-${end}`,
                    startLine: i + 1,
                    endLine: end,
                });
            }
        }
        return chunks;
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    /** Simple tokenizer: lowercase, split on non-alphanum, filter stopwords */
    private tokenize(text: string): string[] {
        return text.toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(t => t.length > 2 && !STOPWORDS.has(t));
    }

    /** Unique key for a chunk (path + line range) */
    private chunkKey(chunk: ContextChunk): string {
        return `${chunk.source}:${chunk.startLine}-${chunk.endLine}`;
    }

    /** Reset session state (seen chunks) */
    reset(): void {
        this.seenChunks.clear();
    }

    // ── Formatting ─────────────────────────────────────────────────────────

    /** Format assembly result for MCP response */
    static format(result: AssemblyResult, config: BudgetConfig): string {
        const lines: string[] = [
            `⚡ HyperTune Max — ${result.selected.length} chunks selected`,
            `Budget: ${config.effectiveBudget.toLocaleString()} tokens (${config.taskMultiplier}x ${config.reason})`,
            `Quality: ${result.totalQuality.toFixed(2)} │ Tokens: ${result.totalTokens.toLocaleString()} │ Efficiency: ${(result.efficiency * 1000).toFixed(2)} q/kT`,
            `Rejected: ${result.rejectedCount} chunks (below quality threshold or over budget)`,
            '',
        ];

        // Group chunks by file
        const fileGroups = new Map<string, ContextChunk[]>();
        for (const chunk of result.selected) {
            const existing = fileGroups.get(chunk.source) ?? [];
            existing.push(chunk);
            fileGroups.set(chunk.source, existing);
        }

        for (const [filePath, chunks] of fileGroups) {
            const totalFileTokens = chunks.reduce((s, c) => s + c.tokens, 0);
            const action = chunks.length === 1 && chunks[0].startLine === 1
                ? '✅ Read fully'
                : `✂️ Read ${chunks.length} section(s)`;
            lines.push(`${action} ${path.basename(filePath)} (${totalFileTokens.toLocaleString()} tokens)`);
            for (const c of chunks) {
                lines.push(`  └ L${c.startLine}-${c.endLine}: ${c.label} (q=${c.quality.toFixed(2)})`);
            }
        }

        return lines.join('\n');
    }
}

// ── Stopwords ────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
    'the', 'and', 'for', 'this', 'that', 'with', 'from', 'are', 'was', 'not',
    'but', 'have', 'has', 'had', 'will', 'can', 'all', 'been', 'its', 'may',
    'use', 'new', 'each', 'which', 'their', 'any', 'also', 'when', 'how',
    'let', 'var', 'const', 'return', 'import', 'export', 'function', 'class',
]);
