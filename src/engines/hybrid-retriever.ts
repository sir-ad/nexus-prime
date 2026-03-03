/**
 * Hybrid Retriever
 *
 * Combines graph traversal with keyword-based search for comprehensive
 * knowledge retrieval. Uses GraphMemoryEngine for facts and
 * GraphTraversalEngine for connected context.
 *
 * Phase: 8D (Graph Knowledge Engine)
 */

import { GraphMemoryEngine, type Entity } from './graph-memory.js';
import { GraphTraversalEngine, type TraversalResult } from './graph-traversal.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface HybridResult {
    // Direct matches (keyword search)
    directMatches: Array<{
        entity: Entity;
        fact: string;
        score: number;
    }>;

    // Graph-connected context (traversal)
    graphContext: TraversalResult;

    // Combined content for the agent
    combinedContent: string[];

    // Scoring metadata
    totalEntities: number;
    searchMethod: 'keyword' | 'graph' | 'hybrid';
}

// ─────────────────────────────────────────────────────────────────────────────
// Hybrid Retriever
// ─────────────────────────────────────────────────────────────────────────────

export class HybridRetriever {
    private graph: GraphMemoryEngine;
    private traversal: GraphTraversalEngine;

    constructor(graph: GraphMemoryEngine) {
        this.graph = graph;
        this.traversal = new GraphTraversalEngine(graph.getDb());
    }

    /**
     * Hybrid retrieval: keyword search + graph expansion.
     *
     * 1. Find entities matching the query by name
     * 2. Get their current facts
     * 3. Traverse the graph N hops from matches for connected context
     * 4. Score and rank all results
     */
    async retrieve(query: string, k: number = 10, depth: number = 2): Promise<HybridResult> {
        const queryLower = query.toLowerCase();
        const keywords = queryLower.split(/\s+/).filter(w => w.length > 2);

        // ── Stage 1: Direct entity search ────────────────────────────────
        const matchedEntities = this.graph.findEntities(query, k * 2);

        const directMatches: HybridResult['directMatches'] = [];
        for (const entity of matchedEntities) {
            const fact = this.graph.getCurrentFact(entity.id);
            const nameScore = this.scoreMatch(entity.name, keywords);
            const factScore = fact ? this.scoreMatch(fact.content, keywords) * 0.7 : 0;

            if (nameScore > 0 || factScore > 0) {
                directMatches.push({
                    entity,
                    fact: fact?.content ?? '',
                    score: nameScore + factScore,
                });
            }
        }

        directMatches.sort((a, b) => b.score - a.score);
        const topDirect = directMatches.slice(0, k);

        // ── Stage 2: Graph expansion ─────────────────────────────────────
        let graphContext: TraversalResult = { entities: [], relations: [], paths: [], depth };

        if (topDirect.length > 0) {
            const seedIds = topDirect.slice(0, 3).map(m => m.entity.id);
            const subgraph = this.traversal.extractSubgraph(seedIds, depth);
            graphContext = {
                entities: subgraph.entities,
                relations: subgraph.relations,
                paths: [],
                depth,
            };
        } else {
            // Fallback: try name-based traversal
            const result = this.traversal.queryByName(query, depth);
            if (result.entities.length > 0) {
                graphContext = result;
            }
        }

        // ── Stage 3: Combine and rank ────────────────────────────────────
        const seenContent = new Set<string>();
        const combinedContent: string[] = [];

        // Add direct match facts first (highest priority)
        for (const match of topDirect) {
            if (match.fact && !seenContent.has(match.fact)) {
                seenContent.add(match.fact);
                combinedContent.push(match.fact);
            }
        }

        // Add graph context facts
        for (const entity of graphContext.entities) {
            const fact = this.graph.getCurrentFact(entity.id);
            if (fact && !seenContent.has(fact.content)) {
                seenContent.add(fact.content);
                combinedContent.push(fact.content);
            }
        }

        const searchMethod: HybridResult['searchMethod'] =
            topDirect.length > 0 && graphContext.entities.length > 0 ? 'hybrid'
                : topDirect.length > 0 ? 'keyword'
                    : 'graph';

        return {
            directMatches: topDirect,
            graphContext,
            combinedContent: combinedContent.slice(0, k),
            totalEntities: new Set([
                ...topDirect.map(m => m.entity.id),
                ...graphContext.entities.map(e => e.id),
            ]).size,
            searchMethod,
        };
    }

    /**
     * Get connectivity score for a chunk (used by HyperTune).
     * Returns 0.0-1.0 based on how connected the related entity is.
     */
    getConnectivity(source: string, label: string): number {
        // Find entity matching the source file or label
        const entities = this.graph.findEntities(label, 1);
        if (entities.length === 0) return 0.0;

        // Use centrality as connectivity signal
        const centrality = this.traversal.computeCentrality(50);
        const match = centrality.find(c => c.entityId === entities[0].id);
        return match?.score ?? 0.0;
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    /** Score a text string against query keywords */
    private scoreMatch(text: string, keywords: string[]): number {
        if (keywords.length === 0) return 0;
        const textLower = text.toLowerCase();
        let matches = 0;
        for (const kw of keywords) {
            if (textLower.includes(kw)) matches++;
        }
        return matches / keywords.length;
    }

    /** Format hybrid result for display */
    static format(result: HybridResult): string {
        const lines: string[] = [
            `🔍 Hybrid Retrieval — ${result.totalEntities} entities (method: ${result.searchMethod})`,
            '',
        ];

        if (result.directMatches.length > 0) {
            lines.push(`📎 Direct Matches: ${result.directMatches.length}`);
            for (const match of result.directMatches.slice(0, 5)) {
                lines.push(`  • ${match.entity.name} [${match.entity.type}] (score: ${match.score.toFixed(2)})`);
            }
        }

        if (result.graphContext.entities.length > 0) {
            lines.push('');
            lines.push(`🕸️ Graph Context: ${result.graphContext.entities.length} connected entities`);
            for (const e of result.graphContext.entities.slice(0, 5)) {
                lines.push(`  • ${e.name} [${e.type}]`);
            }
            if (result.graphContext.relations.length > 0) {
                lines.push(`  📈 ${result.graphContext.relations.length} relations discovered`);
            }
        }

        if (result.combinedContent.length > 0) {
            lines.push('');
            lines.push(`📝 ${result.combinedContent.length} fact(s) retrieved`);
        }

        return lines.join('\n');
    }
}
