/**
 * Graph Memory Engine — Core CRUD
 *
 * Provides entity, relation, and fact version management on top of SQLite.
 * Implements IMemoryStore for backward compatibility with MemoryEngine.
 *
 * Phase: 8D (Graph Knowledge Engine)
 * Constraint: < 500 LOC — traversal logic is in graph-traversal.ts
 */

import Database from 'better-sqlite3';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { EntityExtractor, type ExtractedEntity, type ExtractedRelation } from './entity-extractor.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Entity {
    id: string;
    name: string;
    type: string;
    properties: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
}

export interface Relation {
    id: string;
    fromEntity: string;
    toEntity: string;
    type: string;
    weight: number;
    validFrom: number;
    validUntil: number | null;
}

export interface FactVersion {
    id: string;
    entityId: string;
    content: string;
    version: number;
    validFrom: number;
    validUntil: number | null;
    supersededBy: string | null;
}

/** IMemoryStore — backward compatibility interface */
export interface IMemoryStore {
    store(content: string, priority: number, tags: string[]): string;
    recall(query: string, k: number): Promise<string[]>;
    getStats(): { prefrontal: number; hippocampus: number; cortex: number; totalLinks: number; oldestEntry: number | null; topTags: string[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph Memory Engine
// ─────────────────────────────────────────────────────────────────────────────

export class GraphMemoryEngine implements IMemoryStore {
    private db: Database.Database;
    private extractor: EntityExtractor;

    constructor(dbPath?: string) {
        const dbDir = path.join(os.homedir(), '.nexus-prime');
        fs.mkdirSync(dbDir, { recursive: true });

        const resolvedPath = dbPath ?? path.join(dbDir, 'graph.db');
        this.db = new Database(resolvedPath);
        this.db.pragma('foreign_keys = ON');
        this.extractor = new EntityExtractor();

        this.initSchema();
    }

    // ── Schema ─────────────────────────────────────────────────────────────

    private initSchema(): void {
        const schemaPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'graph-schema.sql');
        let schema: string;
        try {
            schema = fs.readFileSync(schemaPath, 'utf-8');
        } catch {
            // Inline fallback if .sql file not found in dist
            schema = this.inlineSchema();
        }
        this.db.exec(schema);
    }

    private inlineSchema(): string {
        return `
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
        properties TEXT DEFAULT '{}', embedding BLOB,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        from_entity TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        to_entity TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        type TEXT NOT NULL, weight REAL DEFAULT 1.0,
        valid_from INTEGER NOT NULL, valid_until INTEGER,
        UNIQUE(from_entity, to_entity, type, valid_from)
      );
      CREATE TABLE IF NOT EXISTS fact_versions (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        content TEXT NOT NULL, version INTEGER NOT NULL,
        valid_from INTEGER NOT NULL, valid_until INTEGER, superseded_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_entity_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entity_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_relation_from ON relations(from_entity);
      CREATE INDEX IF NOT EXISTS idx_relation_to ON relations(to_entity);
      CREATE INDEX IF NOT EXISTS idx_fact_entity ON fact_versions(entity_id);
      CREATE INDEX IF NOT EXISTS idx_fact_valid ON fact_versions(entity_id, valid_until);
    `;
    }

    // ── Entity CRUD ────────────────────────────────────────────────────────

    /** Create or update an entity */
    upsertEntity(name: string, type: string, properties: Record<string, unknown> = {}): Entity {
        const now = Date.now();
        const existing = this.db.prepare(
            'SELECT id FROM entities WHERE name = ? AND type = ?'
        ).get(name, type) as { id: string } | undefined;

        if (existing) {
            this.db.prepare(
                'UPDATE entities SET properties = ?, updated_at = ? WHERE id = ?'
            ).run(JSON.stringify(properties), now, existing.id);
            return this.getEntity(existing.id)!;
        }

        const id = randomUUID();
        this.db.prepare(
            'INSERT INTO entities (id, name, type, properties, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(id, name, type, JSON.stringify(properties), now, now);

        return { id, name, type, properties, createdAt: now, updatedAt: now };
    }

    /** Get entity by ID */
    getEntity(id: string): Entity | null {
        const row = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as any;
        if (!row) return null;
        return this.rowToEntity(row);
    }

    /** Find entities by name (partial match) */
    findEntities(query: string, limit: number = 20): Entity[] {
        const rows = this.db.prepare(
            'SELECT * FROM entities WHERE name LIKE ? ORDER BY updated_at DESC LIMIT ?'
        ).all(`%${query}%`, limit) as any[];
        return rows.map(r => this.rowToEntity(r));
    }

    /** Find entities by type */
    findByType(type: string, limit: number = 50): Entity[] {
        const rows = this.db.prepare(
            'SELECT * FROM entities WHERE type = ? ORDER BY updated_at DESC LIMIT ?'
        ).all(type, limit) as any[];
        return rows.map(r => this.rowToEntity(r));
    }

    /** Delete entity (cascades to relations and facts) */
    deleteEntity(id: string): boolean {
        const result = this.db.prepare('DELETE FROM entities WHERE id = ?').run(id);
        return result.changes > 0;
    }

    // ── Relation CRUD ──────────────────────────────────────────────────────

    /** Create a relation between two entities */
    addRelation(fromEntityId: string, toEntityId: string, type: string, weight: number = 1.0): Relation {
        const id = randomUUID();
        const now = Date.now();
        this.db.prepare(
            'INSERT OR IGNORE INTO relations (id, from_entity, to_entity, type, weight, valid_from) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(id, fromEntityId, toEntityId, type, weight, now);
        return { id, fromEntity: fromEntityId, toEntity: toEntityId, type, weight, validFrom: now, validUntil: null };
    }

    /** Get relations for an entity (outgoing) */
    getRelationsFrom(entityId: string): Relation[] {
        const rows = this.db.prepare(
            'SELECT * FROM relations WHERE from_entity = ? AND valid_until IS NULL'
        ).all(entityId) as any[];
        return rows.map(r => this.rowToRelation(r));
    }

    /** Get relations to an entity (incoming) */
    getRelationsTo(entityId: string): Relation[] {
        const rows = this.db.prepare(
            'SELECT * FROM relations WHERE to_entity = ? AND valid_until IS NULL'
        ).all(entityId) as any[];
        return rows.map(r => this.rowToRelation(r));
    }

    /** Expire a relation (soft delete) */
    expireRelation(id: string): void {
        this.db.prepare('UPDATE relations SET valid_until = ? WHERE id = ?').run(Date.now(), id);
    }

    // ── Fact Versioning ────────────────────────────────────────────────────

    /** Add a new fact version for an entity */
    addFact(entityId: string, content: string): FactVersion {
        const now = Date.now();
        const id = randomUUID();

        // Supersede the current fact
        const current = this.db.prepare(
            'SELECT id, version FROM fact_versions WHERE entity_id = ? AND valid_until IS NULL ORDER BY version DESC LIMIT 1'
        ).get(entityId) as { id: string; version: number } | undefined;

        const version = current ? current.version + 1 : 1;

        if (current) {
            this.db.prepare(
                'UPDATE fact_versions SET valid_until = ?, superseded_by = ? WHERE id = ?'
            ).run(now, id, current.id);
        }

        this.db.prepare(
            'INSERT INTO fact_versions (id, entity_id, content, version, valid_from) VALUES (?, ?, ?, ?, ?)'
        ).run(id, entityId, content, version, now);

        return { id, entityId, content, version, validFrom: now, validUntil: null, supersededBy: null };
    }

    /** Get current fact for an entity */
    getCurrentFact(entityId: string): FactVersion | null {
        const row = this.db.prepare(
            'SELECT * FROM fact_versions WHERE entity_id = ? AND valid_until IS NULL ORDER BY version DESC LIMIT 1'
        ).get(entityId) as any;
        return row ? this.rowToFact(row) : null;
    }

    /** Get fact history for an entity */
    getFactHistory(entityId: string): FactVersion[] {
        const rows = this.db.prepare(
            'SELECT * FROM fact_versions WHERE entity_id = ? ORDER BY version ASC'
        ).all(entityId) as any[];
        return rows.map(r => this.rowToFact(r));
    }

    // ── Auto-Extract ───────────────────────────────────────────────────────

    /** Extract entities and relations from text and ingest them */
    ingestFromText(text: string, tags: string[] = []): { entities: Entity[]; relations: Relation[] } {
        const { entities: extracted, relations: extractedRels } = this.extractor.extract(text);
        const tagEntities = this.extractor.extractFromTags(tags);
        const allExtracted = [...extracted, ...tagEntities];

        const entities: Entity[] = [];
        const entityMap = new Map<string, Entity>();

        for (const ex of allExtracted) {
            const entity = this.upsertEntity(ex.name, ex.type, { confidence: ex.confidence });
            entities.push(entity);
            entityMap.set(ex.name.toLowerCase(), entity);
        }

        const relations: Relation[] = [];
        for (const rel of extractedRels) {
            const from = entityMap.get(rel.from.toLowerCase());
            const to = entityMap.get(rel.to.toLowerCase());
            if (from && to) {
                const relation = this.addRelation(from.id, to.id, rel.type, rel.confidence);
                relations.push(relation);
            }
        }

        return { entities, relations };
    }

    // ── IMemoryStore compat ────────────────────────────────────────────────

    /** Store: creates entity + fact, extracts sub-entities */
    store(content: string, priority: number = 1.0, tags: string[] = []): string {
        const entity = this.upsertEntity(
            `memory-${Date.now()}-${randomUUID().slice(0, 8)}`,
            'concept',
            { priority, tags, source: 'memory_store' }
        );
        this.addFact(entity.id, content);
        this.ingestFromText(content, tags);
        return entity.id;
    }

    /** Recall: search entities + facts by keyword */
    async recall(query: string, k: number = 5): Promise<string[]> {
        const queryLower = query.toLowerCase();

        // Search facts by content
        const factRows = this.db.prepare(`
      SELECT fv.content, e.name, e.type
      FROM fact_versions fv
      JOIN entities e ON fv.entity_id = e.id
      WHERE fv.valid_until IS NULL
      ORDER BY fv.valid_from DESC
      LIMIT 200
    `).all() as any[];

        const scored = factRows.map(row => {
            const content = row.content as string;
            const name = row.name as string;
            const contentLower = content.toLowerCase();
            const nameLower = name.toLowerCase();

            // Simple keyword scoring
            const keywords = queryLower.split(/\s+/).filter(k => k.length > 2);
            let score = 0;
            for (const kw of keywords) {
                if (nameLower.includes(kw)) score += 2.0;
                if (contentLower.includes(kw)) score += 1.0;
            }

            return { content, score };
        });

        return scored
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, k)
            .map(s => s.content);
    }

    /** Get stats compatible with MemoryEngine.getStats() */
    getStats(): { prefrontal: number; hippocampus: number; cortex: number; totalLinks: number; oldestEntry: number | null; topTags: string[] } {
        const entityCount = (this.db.prepare('SELECT COUNT(*) as c FROM entities').get() as any).c as number;
        const relationCount = (this.db.prepare('SELECT COUNT(*) as c FROM relations WHERE valid_until IS NULL').get() as any).c as number;
        const factCount = (this.db.prepare('SELECT COUNT(*) as c FROM fact_versions WHERE valid_until IS NULL').get() as any).c as number;

        const oldest = (this.db.prepare('SELECT MIN(created_at) as t FROM entities').get() as any).t as number | null;

        const topTypes = this.db.prepare(
            'SELECT type, COUNT(*) as c FROM entities GROUP BY type ORDER BY c DESC LIMIT 5'
        ).all() as any[];

        return {
            prefrontal: entityCount,
            hippocampus: factCount,
            cortex: relationCount,
            totalLinks: relationCount,
            oldestEntry: oldest,
            topTags: topTypes.map(r => r.type as string),
        };
    }

    // ── Graph Stats ────────────────────────────────────────────────────────

    /** Get graph-specific statistics */
    getGraphStats(): { entities: number; relations: number; facts: number; types: Record<string, number> } {
        const entities = (this.db.prepare('SELECT COUNT(*) as c FROM entities').get() as any).c as number;
        const relations = (this.db.prepare('SELECT COUNT(*) as c FROM relations WHERE valid_until IS NULL').get() as any).c as number;
        const facts = (this.db.prepare('SELECT COUNT(*) as c FROM fact_versions').get() as any).c as number;

        const typeRows = this.db.prepare('SELECT type, COUNT(*) as c FROM entities GROUP BY type').all() as any[];
        const types: Record<string, number> = {};
        for (const row of typeRows) types[row.type] = row.c;

        return { entities, relations, facts, types };
    }

    /** Get the underlying database (for graph-traversal.ts) */
    getDb(): Database.Database {
        return this.db;
    }

    /** Flush / close database */
    close(): void {
        this.db.close();
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

    private rowToFact(row: any): FactVersion {
        return {
            id: row.id,
            entityId: row.entity_id,
            content: row.content,
            version: row.version,
            validFrom: row.valid_from,
            validUntil: row.valid_until,
            supersededBy: row.superseded_by,
        };
    }
}
