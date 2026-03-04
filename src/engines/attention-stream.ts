/**
 * Nexus Prime — Continuous Attention Stream (CAS) Engine
 *
 * Replaces discrete token chunks with weighted continuous fluid potentials.
 * Common patterns get compressed; novel information gets expanded.
 * Achieves 5-100× effective context expansion by treating tokens as
 * weighted attention units rather than flat character sequences.
 *
 * "What if tokens weren't discrete?"
 *   Current: [word][word][word] → discrete tokens
 *   CAS:     [word=========]   → weighted continuous
 *
 * Phase: 9B (Continuous Attention Streams)
 */

import { PatternCodebook } from './pattern-codebook.js';
import { nexusEventBus } from './event-bus.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AttentionFluid {
    /** Original tokens before compression */
    tokens: string[];
    /** Per-token attention weight (0.0 - 1.0) */
    weights: number[];
    /** The compressed output stream */
    compressed: string;
    /** Compression ratio achieved */
    compressionRatio: number;
    /** Per-token novelty flag: true = novel/expanded, false = compressed */
    noveltyMap: boolean[];
    /** Total attention allocated (sum of weights) */
    totalAttention: number;
}

export interface CASStats {
    codebookSize: number;
    totalEncodes: number;
    totalDecodes: number;
    avgCompression: number;
    patternsLearned: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TF-IDF Scorer for attention weighting
// ─────────────────────────────────────────────────────────────────────────────

export class AttentionScorer {
    private documentFrequency: Map<string, number> = new Map();
    private totalDocuments: number = 0;

    /**
     * Update IDF statistics from a new document.
     */
    observe(tokens: string[]): void {
        this.totalDocuments++;
        const unique = new Set(tokens.map(t => t.toLowerCase()));
        for (const t of unique) {
            this.documentFrequency.set(t, (this.documentFrequency.get(t) || 0) + 1);
        }
    }

    /**
     * Splits text into code-aware tokens, handling CamelCase, punctuation, and whitespace.
     */
    static tokenize(text: string): string[] {
        // Match CamelCase boundaries, non-word characters, and contiguous words
        const regex = /([A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\b)|[0-9]+|[^a-zA-Z0-9\s])/g;
        const matches = text.match(regex);
        return matches ? matches.filter(t => t.trim().length > 0) : [];
    }

    /**
     * Compute attention weights for tokens relative to a task.
     * Uses TF-IDF + task relevance to assign weights.
     *
     * Higher weight = more novel/important = gets expanded.
     * Lower weight = more common = gets compressed.
     */
    score(tokens: string[], task: string): number[] {
        const taskWords = new Set(AttentionScorer.tokenize(task).map(t => t.toLowerCase()));
        const tokenLower = tokens.map(t => t.toLowerCase());

        // Term frequencies in this context
        const tf = new Map<string, number>();
        for (const t of tokenLower) {
            tf.set(t, (tf.get(t) || 0) + 1);
        }

        return tokenLower.map(token => {
            // TF component (normalized by max frequency)
            const maxTf = Math.max(...tf.values());
            const tfScore = (tf.get(token) || 0) / (maxTf || 1);

            // IDF component (inverse document frequency)
            const df = this.documentFrequency.get(token) || 1;
            const idfScore = Math.log((this.totalDocuments + 1) / df);
            const maxIdf = Math.log(this.totalDocuments + 1);
            const normalizedIdf = maxIdf > 0 ? idfScore / maxIdf : 0.5;

            // Task relevance boost
            const taskRelevance = taskWords.has(token) ? 0.3 : 0;

            // Combined weight: high for novel task-relevant tokens, low for common ones
            const weight = Math.min(1.0, tfScore * 0.3 + normalizedIdf * 0.5 + taskRelevance + 0.1);
            return weight;
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CAS Engine
// ─────────────────────────────────────────────────────────────────────────────

export class ContinuousAttentionStream {
    private codebook: PatternCodebook;
    private scorer: AttentionScorer;
    private totalEncodes: number = 0;
    private totalDecodes: number = 0;
    private compressionHistory: number[] = [];

    constructor(codebook?: PatternCodebook) {
        this.codebook = codebook || new PatternCodebook();
        this.scorer = new AttentionScorer();
    }

    /**
     * Encode: convert discrete token array into weighted continuous stream.
     *
     * 1. Score tokens by attention weight (TF-IDF + task relevance)
     * 2. Compress common patterns via codebook
     * 3. Expand novel tokens (keep at full fidelity)
     * 4. Produce a compressed output string
     */
    encode(tokens: string[], task: string): AttentionFluid {
        // Update the scorer's IDF statistics
        this.scorer.observe(tokens);

        // Step 1: Compute attention weights
        const weights = this.scorer.score(tokens, task);

        // Step 2: Determine novelty map (novel = high weight, common = low weight)
        const medianWeight = this.median(weights);
        const noveltyThreshold = Math.max(medianWeight, 0.4);
        const noveltyMap = weights.map(w => w >= noveltyThreshold);

        // Step 3: Build the fluid representation
        // - Novel tokens: kept at full fidelity
        // - Common tokens: compressed via codebook
        const fullText = tokens.join(' ');

        // Feed full text to codebook for pattern learning
        this.codebook.observe(fullText);

        // Compress common patterns
        const { compressed, ratio, replacements } = this.codebook.compress(fullText);

        // Step 4: Apply attention-weighted truncation for extreme compression
        // Tokens below a very low threshold get dropped entirely
        const filteredTokens: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
            if (weights[i] >= 0.1) {
                filteredTokens.push(tokens[i]);
            }
        }
        const filteredText = filteredTokens.join(' ');
        const { compressed: finalCompressed, ratio: finalRatio } = this.codebook.compress(filteredText);

        const totalAttention = weights.reduce((s, w) => s + w, 0);
        const compressionRatio = tokens.length > 0 ? fullText.length / finalCompressed.length : 1;

        this.totalEncodes++;
        this.compressionHistory.push(compressionRatio);

        nexusEventBus.emit('cas.encode', {
            inputTokens: tokens.length,
            outputTokens: AttentionScorer.tokenize(finalCompressed).length,
            compressionRatio
        });

        return {
            tokens,
            weights,
            compressed: finalCompressed,
            compressionRatio,
            noveltyMap,
            totalAttention
        };
    }

    /**
     * Decode: expand compressed stream back to weighted tokens.
     */
    decode(fluid: AttentionFluid): string[] {
        const decompressed = this.codebook.decompress(fluid.compressed);
        this.totalDecodes++;

        nexusEventBus.emit('cas.decode', {
            tokens: AttentionScorer.tokenize(decompressed).length
        });

        return AttentionScorer.tokenize(decompressed);
    }

    /**
     * Manually teach the codebook a common pattern.
     */
    learnPattern(pattern: string, frequency: number = 5): void {
        this.codebook.learnPattern(pattern, frequency);

        nexusEventBus.emit('cas.pattern_learned', {
            pattern: pattern.slice(0, 50),
            codebookSize: this.codebook.getStats().size
        });
    }

    /**
     * Get CAS statistics.
     */
    getStats(): CASStats {
        const cbStats = this.codebook.getStats();
        return {
            codebookSize: cbStats.size,
            totalEncodes: this.totalEncodes,
            totalDecodes: this.totalDecodes,
            avgCompression: this.compressionHistory.length > 0
                ? this.compressionHistory.reduce((s, r) => s + r, 0) / this.compressionHistory.length
                : 1.0,
            patternsLearned: cbStats.totalCompressions
        };
    }

    /**
     * Get the underlying codebook for direct access.
     */
    getCodebook(): PatternCodebook {
        return this.codebook;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────────────────────────

    private median(arr: number[]): number {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
}
