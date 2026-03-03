/**
 * Graph Traversal Engine
 *
 * N-hop graph traversal, path finding, and centrality scoring.
 * Operates on the same SQLite database as GraphMemoryEngine.
 *
 * Phase: 8D (Graph Knowledge Engine)
 * Constraint: < 500 LOC — core CRUD is in graph-memory.ts
 */

import type Database from 'better-sqlite3';
import type { Entity, Relation } from './graph-memory.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TraversalResult {
    entities: Entity[];
    relations: Relation[];
    paths: string[][];      // Each path is array of entity IDs
    depth: number;
}

export interface CentralityScore {
    entityId: string;
    entityName: string;
    score: number;          // higher = more connected
    inDegree: number;
    outDegree: number;
}

export interface SubgraphResult {
    entities: Entity[];
    relations: Relation[];
    stats: {
        nodeCount: number;
        edgeCount: number;
        density: number;
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph Traversal Engine
// ─────────────────────────────────────────────────────────────────────────────

export class GraphTraversalEngine {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
    }

    // ── N-Hop Traversal ────────────────────────────────────────────────────

    /**
     * Traverse N hops from a starting entity.
     * Returns all reachable entities, relations, and discovered paths.
     */
    traverse(startEntityId: string, maxDepth: number = 2): TraversalResult {
        const visited = new Set<string>();
        const entities: Entity[] = [];
        const relations: Relation[] = [];
        const paths: string[][] = [];

        // BFS traversal
        const queue: Array<{ entityId: string; depth: number; path: string[] }> = [
            { entityId: startEntityId, depth: 0, path: [startEntityId] },
        ];

        while (queue.length > 0) {
            const { entityId, depth, path } = queue.shift()!;

            if (visited.has(entityId)) continue;
            visited.add(entityId);

            // Load entity
            const entityRow = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(entityId) as any;
            if (entityRow) {
                entities.push(this.rowToEntity(entityRow));
            }

            if (path.length > 1) {
                paths.push([...path]);
            }

            // Stop exploring if at max depth
            if (depth >= maxDepth) continue;

            // Get outgoing relations
            const outgoing = this.db.prepare(
                'SELECT * FROM relations WHERE from_entity = ? AND valid_until IS NULL'
            ).all(entityId) as any[];

            for (const rel of outgoing) {
                relations.push(this.rowToRelation(rel));
                if (!visited.has(rel.to_entity)) {
                    queue.push({
                        entityId: rel.to_entity,
                        depth: depth + 1,
                        path: [...path, rel.to_entity],
                    });
                }
            }

            // Get incoming relations
            const incoming = this.db.prepare(
                'SELECT * FROM relations WHERE to_entity = ? AND valid_until IS NULL'
            ).all(entityId) as any[];

            for (const rel of incoming) {
                relations.push(this.rowToRelation(rel));
                if (!visited.has(rel.from_entity)) {
                    queue.push({
                        entityId: rel.from_entity,
                        depth: depth + 1,
                        path: [...path, rel.from_entity],
                    });
                }
            }
        }

        return { entities, relations, paths, depth: maxDepth };
    }

    // ── Shortest Path ──────────────────────────────────────────────────────

    /**
     * Find shortest path between two entities using BFS.
     * Returns null if no path exists within maxDepth hops.
     */
    shortestPath(fromId: string, toId: string, maxDepth: number = 5): string[] | null {
        if (fromId === toId) return [fromId];

        const visited = new Set<string>();
        const queue: Array<{ entityId: string; path: string[] }> = [
            { entityId: fromId, path: [fromId] },
        ];

        while (queue.length > 0) {
            const { entityId, path } = queue.shift()!;

            if (path.length > maxDepth + 1) continue;
            if (visited.has(entityId)) continue;
            visited.add(entityId);

            // Get neighbors (both directions)
            const neighbors = this.db.prepare(`
        SELECT to_entity AS neighbor FROM relations WHERE from_entity = ? AND valid_until IS NULL
        UNION
        SELECT from_entity AS neighbor FROM relations WHERE to_entity = ? AND valid_until IS NULL
      `).all(entityId, entityId) as any[];

            for (const row of neighbors) {
                const neighbor = row.neighbor as string;
                if (neighbor === toId) return [...path, neighbor];
                if (!visited.has(neighbor)) {
                    queue.push({ entityId: neighbor, path: [...path, neighbor] });
                }
            }
        }

        return null; // No path found
    }

    // ── Centrality ─────────────────────────────────────────────────────────

    /**
     * Compute degree centrality for all entities.
     * Returns entities sorted by centrality score (most connected first).
     */
    computeCentrality(limit: number = 20): CentralityScore[] {
        const rows = this.db.prepare(`
      SELECT e.id, e.name,
        COALESCE(out_deg.c, 0) as out_degree,
        COALESCE(in_deg.c, 0) as in_degree
      FROM entities e
      LEFT JOIN (
        SELECT from_entity, COUNT(*) as c FROM relations WHERE valid_until IS NULL GROUP BY from_entity
      ) out_deg ON e.id = out_deg.from_entity
      LEFT JOIN (
        SELECT to_entity, COUNT(*) as c FROM relations WHERE valid_until IS NULL GROUP BY to_entity
      ) in_deg ON e.id = in_deg.to_entity
      ORDER BY (COALESCE(out_deg.c, 0) + COALESCE(in_deg.c, 0)) DESC
      LIMIT ?
    `).all(limit) as any[];

        const totalEntities = (this.db.prepare('SELECT COUNT(*) as c FROM entities').get() as any).c as number;

        return rows.map(row => ({
            entityId: row.id,
            entityName: row.name,
            inDegree: row.in_degree,
            outDegree: row.out_degree,
            // Normalized degree centrality
            score: totalEntities > 1
                ? (row.in_degree + row.out_degree) / (2 * (totalEntities - 1))
                : 0,
        }));
    }

    // ── Subgraph Extraction ────────────────────────────────────────────────

    /**
     * Extract a subgraph around a set of entity IDs (union of their neighborhoods).
     */
    extractSubgraph(entityIds: string[], depth: number = 1): SubgraphResult {
        const allEntities = new Map<string, Entity>();
        const allRelations = new Map<string, Relation>();

        for (const id of entityIds) {
            const result = this.traverse(id, depth);
            for (const e of result.entities) allEntities.set(e.id, e);
            for (const r of result.relations) allRelations.set(r.id, r);
        }

        const entities = [...allEntities.values()];
        const relations = [...allRelations.values()];
        const nodeCount = entities.length;
        const edgeCount = relations.length;
        const maxEdges = nodeCount * (nodeCount - 1);
        const density = maxEdges > 0 ? edgeCount / maxEdges : 0;

        return {
            entities,
            relations,
            stats: { nodeCount, edgeCount, density },
        };
    }

    // ── Query by Name ──────────────────────────────────────────────────────

    /**
     * Query the graph starting from entity name (fuzzy match).
     * Convenience wrapper that resolves name → ID → traverse.
     */
    queryByName(name: string, depth: number = 2): TraversalResult {
        const rows = this.db.prepare(
            'SELECT id FROM entities WHERE name LIKE ? ORDER BY updated_at DESC LIMIT 1'
        ).all(`%${name}%`) as any[];

        if (rows.length === 0) {
            return { entities: [], relations: [], paths: [], depth };
        }

        return this.traverse(rows[0].id, depth);
    }

    // ── Formatting ─────────────────────────────────────────────────────────

    /** Format traversal result for MCP response */
    static format(result: TraversalResult): string {
        if (result.entities.length === 0) return '📭 No graph data found.';

        const lines: string[] = [
            `🔗 Graph Query — ${result.entities.length} entities, ${result.relations.length} relations (depth: ${result.depth})`,
            '',
        ];

        // Group entities by type
        const byType = new Map<string, Entity[]>();
        for (const e of result.entities) {
            const list = byType.get(e.type) ?? [];
            list.push(e);
            byType.set(e.type, list);
        }

        for (const [type, entities] of byType) {
            lines.push(`📦 ${type} (${entities.length}):`);
            for (const e of entities.slice(0, 10)) {
                lines.push(`  • ${e.name}`);
            }
            if (entities.length > 10) {
                lines.push(`  ... and ${entities.length - 10} more`);
            }
        }

        if (result.relations.length > 0) {
            lines.push('');
            lines.push(`🔗 Relations (${result.relations.length}):`);

            // Resolve entity names for display
            const entityMap = new Map(result.entities.map(e => [e.id, e.name]));
            for (const rel of result.relations.slice(0, 10)) {
                const from = entityMap.get(rel.fromEntity) ?? rel.fromEntity.slice(0, 8);
                const to = entityMap.get(rel.toEntity) ?? rel.toEntity.slice(0, 8);
                lines.push(`  ${from} —[${rel.type}]→ ${to}`);
            }
            if (result.relations.length > 10) {
                lines.push(`  ... and ${result.relations.length - 10} more`);
            }
        }

        if (result.paths.length > 0) {
            lines.push('');
            lines.push(`🛤️ Paths found: ${result.paths.length}`);
        }

        return lines.join('\n');
    }

    // ── Row Mappers ────────────────────────────────────────────────────────

    private rowToEntity(row: any): Entity {
        return {
            id: row.id,
            name: row.name,
            type: row.type,
            properties: JSON.parse(row.properties ?? '{}'),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    private rowToRelation(row: any): Relation {
        return {
            id: row.id,
            fromEntity: row.from_entity,
            toEntity: row.to_entity,
            type: row.type,
            weight: row.weight,
            validFrom: row.valid_from,
            validUntil: row.valid_until,
        };
    }
}
