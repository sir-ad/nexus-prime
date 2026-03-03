/**
 * Embedder — TF-IDF local embeddings + optional API mode
 *
 * Mode 1 (default): Pure TF-IDF, no API needed. Works offline, fast.
 * Mode 2: OpenAI-compatible API (set NEXUS_EMBED_MODE=api, NEXUS_EMBED_URL, NEXUS_EMBED_KEY)
 *
 * Output: fixed 128-dim float32 vectors (TF-IDF) or 1536-dim (API)
 */

import * as path from 'path';
import * as os from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// TF-IDF Vocabulary (built from stored documents)
// ─────────────────────────────────────────────────────────────────────────────

const VECTOR_DIM = 128; // local TF-IDF dimension

/** Stop words — excluded from TF-IDF vocabulary */
const STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'and', 'or', 'but', 'if', 'then',
    'that', 'this', 'it', 'its', 'we', 'our', 'you', 'i', 'my', 'not',
    'no', 'so', 'up', 'out', 'about', 'just', 'into', 'over', 'after',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Hyperbolic Math (Poincare Ball Model)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Poincare Ball model for hyperbolic space.
 * Hyperbolic distance is better suited for hierarchical structures (trees/code).
 */
export const HyperbolicMath = {
    /** 
     * Hyperbolic distance between two points in the unit ball.
     * d(u, v) = arcosh(1 + 2 * ||u-v||^2 / ( (1-||u||^2)(1-||v||^2) ))
     */
    dist(u: number[], v: number[]): number {
        const diffSq = u.reduce((sum, ui, i) => sum + Math.pow(ui - (v[i] || 0), 2), 0);
        const normU2 = u.reduce((sum, ui) => sum + ui * ui, 0);
        const normV2 = v.reduce((sum, vi) => sum + vi * vi, 0);

        const eps = 1e-9;
        const den = (1 - normU2) * (1 - normV2);
        if (Math.abs(den) < eps) return 100; // boundary

        const x = 1 + (2 * diffSq) / den;
        // arcosh(x) = ln(x + sqrt(x^2 - 1))
        return Math.log(x + Math.sqrt(x * x - 1));
    },

    /**
     * Mobius addition: u ⊕ v
     * Used to translate points in hyperbolic space while staying in the unit ball.
     */
    mobiusAdd(u: number[], v: number[]): number {
        const dotUV = u.reduce((sum, ui, i) => sum + ui * (v[i] || 0), 0);
        const normU2 = u.reduce((sum, ui) => sum + ui * ui, 0);
        const normV2 = v.reduce((sum, vi) => sum + vi * vi, 0);

        const den = 1 + 2 * dotUV + normU2 * normV2;
        const num1 = (1 + 2 * dotUV + normV2);
        const num2 = (1 - normU2);

        // Resulting vector is scaled combination of u and v
        // In practice for simple hierarchy shifts, we just normalize the final result back to unit ball
        return 0; // Placeholder for simplified logic below
    },

    /** Ensure vector is within unit ball (norm < 1) */
    project(v: number[]): number[] {
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
        const maxNorm = 0.999;
        if (norm <= maxNorm) return v;
        return v.map(x => (x / norm) * maxNorm);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Embedder
// ─────────────────────────────────────────────────────────────────────────────

export class Embedder {
    private vocabulary: Map<string, number> = new Map(); // word → index (0..127)
    private idf: Map<string, number> = new Map();        // word → IDF weight
    private docCount: number = 0;
    private apiMode: boolean;
    private apiUrl: string;
    private apiKey: string;
    private apiModel: string;

    constructor() {
        this.apiMode = process.env.NEXUS_EMBED_MODE === 'api';
        this.apiUrl = process.env.NEXUS_EMBED_URL ?? 'https://api.openai.com/v1/embeddings';
        this.apiKey = process.env.NEXUS_EMBED_KEY ?? '';
        this.apiModel = process.env.NEXUS_EMBED_MODEL ?? 'text-embedding-3-small';
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /** Embed a string → float32 vector */
    async embed(text: string): Promise<number[]> {
        if (this.apiMode && this.apiKey) {
            try {
                const vec = await this.apiEmbed(text);
                return HyperbolicMath.project(vec);
            } catch {
                // Fall back to local on API failure
            }
        }
        return this.localEmbed(text);
    }

    /** 
     * Generate a hierarchical embedding.
     * Shifts the vector "deeper" into the Poincare ball relative to a parent.
     */
    embedHierarchical(text: string, parentVector?: number[], depth: number = 0): number[] {
        const base = this.localEmbed(text);
        if (!parentVector || depth === 0) return base;

        // Hierarchical shift: move towards the boundary (norm -> 1) 
        // while staying in the "shadow" of the parent
        const alpha = 0.3; // alignment with parent
        const shift = 0.2; // depth push

        const blended = base.map((x, i) => (1 - alpha) * x + alpha * parentVector[i]);
        const norm = Math.sqrt(blended.reduce((s, x) => s + x * x, 0));

        // Push towards boundary: new_norm = old_norm + (1 - old_norm) * shift
        const targetNorm = norm + (1 - norm) * (shift * Math.min(depth, 5));
        const scaled = blended.map(x => (x / (norm || 1)) * targetNorm);

        return HyperbolicMath.project(scaled);
    }

    /** Update vocabulary with new documents (call as you store memories) */
    fitVocabulary(docs: string[]): void {
        // Count document frequency for each term
        const dfCount: Map<string, number> = new Map();

        for (const doc of docs) {
            const terms = new Set(this.tokenize(doc));
            for (const term of terms) {
                dfCount.set(term, (dfCount.get(term) ?? 0) + 1);
            }
            this.docCount++;
        }

        // Assign vocab indices (top 128 by df)
        const sorted = [...dfCount.entries()].sort((a, b) => b[1] - a[1]);
        this.vocabulary.clear();
        this.idf.clear();

        for (const [term, df] of sorted.slice(0, VECTOR_DIM)) {
            const idx = this.vocabulary.size;
            this.vocabulary.set(term, idx);
            // IDF = log((N + 1) / (df + 1)) + 1  (smoothed)
            this.idf.set(term, Math.log((this.docCount + 1) / (df + 1)) + 1);
        }
    }

    /** Dimension of vectors produced by this embedder */
    get dimensions(): number {
        return this.apiMode ? 1536 : VECTOR_DIM;
    }

    // ── Local TF-IDF embed ───────────────────────────────────────────────────

    localEmbed(text: string): number[] {
        const tokens = this.tokenize(text);
        const tf: Map<string, number> = new Map();

        for (const t of tokens) {
            tf.set(t, (tf.get(t) ?? 0) + 1);
        }

        const vector = new Array<number>(VECTOR_DIM).fill(0);

        for (const [term, count] of tf) {
            const idx = this.vocabulary.get(term);
            if (idx !== undefined) {
                const idf = this.idf.get(term) ?? 1;
                vector[idx] = (count / tokens.length) * idf; // TF × IDF
            } else {
                // Hash fallback for OOV terms
                const h = this.hashCode(term) % VECTOR_DIM;
                vector[Math.abs(h)] += 0.1;
            }
        }

        return this.normalize(vector);
    }

    // ── API embed (OpenAI-compatible) ────────────────────────────────────────

    async apiEmbed(text: string): Promise<number[]> {
        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.apiModel,
                input: text.slice(0, 8000), // truncate to API limit
            }),
        });

        if (!response.ok) {
            throw new Error(`Embed API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as { data: [{ embedding: number[] }] };
        return data.data[0].embedding;
    }

    // ── Cosine similarity ────────────────────────────────────────────────────

    cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        const denom = Math.sqrt(magA) * Math.sqrt(magB);
        return denom === 0 ? 0 : dot / denom;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private tokenize(text: string): string[] {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9\s_/-]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP_WORDS.has(w));
    }

    private normalize(v: number[]): number[] {
        const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
        if (mag === 0) return v;
        return v.map(x => x / mag);
    }

    private hashCode(s: string): number {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
        }
        return h;
    }
}

export const createEmbedder = () => new Embedder();
