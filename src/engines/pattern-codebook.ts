/**
 * Nexus Prime — Pattern Codebook
 *
 * A learned dictionary of common token/phrase patterns. When a pattern
 * repeats above a threshold frequency, it gets compressed into a single
 * codebook entry, achieving high compression for boilerplate and common
 * idioms while preserving novel content at full fidelity.
 *
 * Phase: 9B (Continuous Attention Streams)
 */

import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CodebookEntry {
    id: string;
    pattern: string;            // The original token sequence
    code: string;               // Short compression code (e.g., "CB_0042")
    frequency: number;          // How often this pattern appears
    weight: number;             // Attention weight (how important it is)
    created: number;
    lastUsed: number;
}

export interface CodebookStats {
    size: number;
    totalCompressions: number;
    avgCompressionRatio: number;
    topPatterns: { pattern: string; frequency: number }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Codebook Engine
// ─────────────────────────────────────────────────────────────────────────────

export class PatternCodebook {
    private entries: Map<string, CodebookEntry> = new Map(); // pattern → entry
    private codeToPattern: Map<string, string> = new Map();  // code → pattern
    private nextCode: number = 0;
    private totalCompressions: number = 0;

    private readonly MIN_FREQUENCY = 3;   // Minimum occurrences before encoding
    private readonly MIN_LENGTH = 8;       // Minimum pattern length in chars
    private readonly MAX_ENTRIES = 2000;   // Maximum codebook size

    /**
     * Observe a token sequence. If it repeats enough, add to codebook.
     */
    observe(text: string): void {
        // Extract n-grams of various sizes
        const ngrams = this.extractNgrams(text, 3, 8);

        for (const ngram of ngrams) {
            if (ngram.length < this.MIN_LENGTH) continue;

            const existing = this.entries.get(ngram);
            if (existing) {
                existing.frequency++;
                existing.lastUsed = Date.now();
            } else {
                // Track it but don't encode yet
                this.entries.set(ngram, {
                    id: randomUUID(),
                    pattern: ngram,
                    code: '', // Empty until frequency threshold met
                    frequency: 1,
                    weight: 0.5,
                    created: Date.now(),
                    lastUsed: Date.now()
                });
            }
        }

        // Assign codes to patterns that crossed the frequency threshold
        for (const [pattern, entry] of this.entries) {
            if (entry.frequency >= this.MIN_FREQUENCY && !entry.code) {
                entry.code = `«CB_${String(this.nextCode++).padStart(4, '0')}»`;
                this.codeToPattern.set(entry.code, pattern);
            }
        }

        // Evict low-frequency entries if codebook is too large
        if (this.entries.size > this.MAX_ENTRIES) {
            this.prune();
        }
    }

    /**
     * Compress text using the learned codebook.
     * Replaces known patterns with their short codes.
     */
    compress(text: string): { compressed: string; ratio: number; replacements: number } {
        let result = text;
        let replacements = 0;

        // Sort entries by pattern length (longest first) to avoid partial matches
        const encodedEntries = Array.from(this.entries.values())
            .filter(e => e.code)
            .sort((a, b) => b.pattern.length - a.pattern.length);

        for (const entry of encodedEntries) {
            const count = (result.split(entry.pattern).length - 1);
            if (count > 0) {
                result = result.split(entry.pattern).join(entry.code);
                replacements += count;
                entry.lastUsed = Date.now();
            }
        }

        this.totalCompressions += replacements;
        const ratio = replacements > 0 ? text.length / result.length : 1.0;

        return { compressed: result, ratio, replacements };
    }

    /**
     * Decompress text — expand codebook codes back to original patterns.
     */
    decompress(text: string): string {
        let result = text;
        for (const [code, pattern] of this.codeToPattern) {
            result = result.split(code).join(pattern);
        }
        return result;
    }

    /**
     * Manually learn a specific pattern (e.g., from external feedback).
     */
    learnPattern(pattern: string, frequency: number = 5): void {
        if (pattern.length < this.MIN_LENGTH) return;

        const existing = this.entries.get(pattern);
        if (existing) {
            existing.frequency = Math.max(existing.frequency, frequency);
            if (!existing.code && existing.frequency >= this.MIN_FREQUENCY) {
                existing.code = `«CB_${String(this.nextCode++).padStart(4, '0')}»`;
                this.codeToPattern.set(existing.code, pattern);
            }
        } else {
            const code = `«CB_${String(this.nextCode++).padStart(4, '0')}»`;
            const entry: CodebookEntry = {
                id: randomUUID(),
                pattern,
                code,
                frequency,
                weight: 0.7,
                created: Date.now(),
                lastUsed: Date.now()
            };
            this.entries.set(pattern, entry);
            this.codeToPattern.set(code, pattern);
        }
    }

    /**
     * Get codebook statistics.
     */
    getStats(): CodebookStats {
        const encoded = Array.from(this.entries.values()).filter(e => e.code);
        const topPatterns = encoded
            .sort((a, b) => b.frequency - a.frequency)
            .slice(0, 10)
            .map(e => ({ pattern: e.pattern.slice(0, 40), frequency: e.frequency }));

        return {
            size: encoded.length,
            totalCompressions: this.totalCompressions,
            avgCompressionRatio: this.totalCompressions > 0
                ? encoded.reduce((s, e) => s + e.pattern.length / e.code.length, 0) / encoded.length
                : 1.0,
            topPatterns
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────────────────────────

    /** Extract word n-grams from text */
    private extractNgrams(text: string, minN: number, maxN: number): string[] {
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const ngrams: string[] = [];

        for (let n = minN; n <= maxN && n <= words.length; n++) {
            for (let i = 0; i <= words.length - n; i++) {
                ngrams.push(words.slice(i, i + n).join(' '));
            }
        }
        return ngrams;
    }

    /** Remove least-used entries when codebook is too large */
    private prune(): void {
        const sorted = Array.from(this.entries.entries())
            .sort((a, b) => a[1].frequency - b[1].frequency);

        const toRemove = sorted.slice(0, Math.floor(sorted.length * 0.2));
        for (const [pattern, entry] of toRemove) {
            if (entry.code) {
                this.codeToPattern.delete(entry.code);
            }
            this.entries.delete(pattern);
        }
    }
}
