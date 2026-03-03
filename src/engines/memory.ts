/**
 * Memory Engine — Persistent Zettelkasten
 *
 * Three-tier memory system backed by SQLite for cross-session persistence.
 * Memories link to each other (Zettelkasten) — recall returns context networks,
 * not just isolated facts. High-value memories trigger fission (broadcast).
 *
 * Persistence: ~/.nexus-prime/memory.db
 * Load on MCP start. Flush on exit.
 */

import Database from 'better-sqlite3';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { Embedder, HyperbolicMath } from './embedder.js';
import { podNetwork } from './pod-network.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryItem {
  id: string;
  content: string;
  priority: number;
  timestamp: number;
  tags: string[];
  tier: 'prefrontal' | 'hippocampus' | 'cortex';
  sessionId?: string;
  accessCount: number;
  links?: string[];  // IDs of related memories (Zettelkasten links)
  parentId?: string;
  depth?: number;
}

export interface MemoryLink {
  fromId: string;
  toId: string;
  weight: number; // 0-1, decays if unused
  type: 'semantic' | 'temporal' | 'tagged';
}

export interface MemoryStats {
  prefrontal: number;
  hippocampus: number;
  cortex: number;
  totalLinks: number;
  oldestEntry: number | null;
  topTags: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// MemoryEngine
// ─────────────────────────────────────────────────────────────────────────────

export class MemoryEngine {
  private db: Database.Database;
  private sessionId: string;

  // In-RAM working tiers (flushed to DB periodically)
  private prefrontal: MemoryItem[] = [];
  private maxPrefrontal = 7;
  private maxHippocampus = 200;

  // Vector index (in-memory TF-IDF) — rebuilt on load
  private embedder: Embedder;
  // Maps vector item id → memory id
  private vectorIdToMemoryId: Map<number, string> = new Map();
  private memoryIdToVectorId: Map<string, number> = new Map();
  private nextVectorId = 1;

  constructor(dbPath?: string) {
    const dbDir = path.join(os.homedir(), '.nexus-prime');
    fs.mkdirSync(dbDir, { recursive: true });

    const resolvedPath = dbPath ?? path.join(dbDir, 'memory.db');
    this.db = new Database(resolvedPath);
    this.sessionId = randomUUID();
    this.embedder = new Embedder();

    this.initSchema();
    this.load();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Schema
  // ─────────────────────────────────────────────────────────────────────────

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id          TEXT PRIMARY KEY,
        content     TEXT NOT NULL,
        priority    REAL NOT NULL DEFAULT 1.0,
        timestamp   INTEGER NOT NULL,
        tags        TEXT NOT NULL DEFAULT '[]',
        tier        TEXT NOT NULL DEFAULT 'hippocampus',
        session_id  TEXT,
        access_count INTEGER NOT NULL DEFAULT 0,
        parent_id   TEXT,
        depth       INTEGER DEFAULT 0
      );
    `);

    // Migration logic for existing tables
    const tableInfo = this.db.prepare("PRAGMA table_info(memories)").all() as any[];
    const columns = tableInfo.map(c => c.name);

    if (!columns.includes('parent_id')) {
      this.db.exec("ALTER TABLE memories ADD COLUMN parent_id TEXT");
    }
    if (!columns.includes('depth')) {
      this.db.exec("ALTER TABLE memories ADD COLUMN depth INTEGER DEFAULT 0");
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_links(
      from_id  TEXT NOT NULL,
      to_id    TEXT NOT NULL,
      weight   REAL NOT NULL DEFAULT 0.5,
      type     TEXT NOT NULL DEFAULT 'semantic',
      PRIMARY KEY(from_id, to_id),
      FOREIGN KEY(from_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY(to_id)   REFERENCES memories(id) ON DELETE CASCADE
    );

      CREATE INDEX IF NOT EXISTS idx_memories_tier      ON memories(tier);
      CREATE INDEX IF NOT EXISTS idx_memories_priority  ON memories(priority DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_links_from         ON memory_links(from_id);
    `);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────────────────────────────────

  /** Restore hippocampus + cortex from DB on startup */
  load(): void {
    const rows = this.db.prepare(
      `SELECT * FROM memories ORDER BY priority DESC, timestamp DESC LIMIT 500`
    ).all() as any[];

    // Fit TF-IDF vocabulary on all stored content
    const allContent = rows.map(r => r.content as string);
    if (allContent.length > 0) {
      this.embedder.fitVocabulary(allContent);
    }

    for (const row of rows) {
      const item: MemoryItem = {
        id: row.id,
        content: row.content,
        priority: row.priority,
        timestamp: row.timestamp,
        tags: JSON.parse(row.tags as string),
        tier: row.tier as MemoryItem['tier'],
        sessionId: row.session_id,
        accessCount: row.access_count
      };

      // Restore prefrontal items to RAM
      if (item.tier === 'prefrontal') {
        this.prefrontal.push(item);
      }

      // Rebuild in-memory vector index (synchronously via local embed)
      this.indexMemory(item.id, item.content);
    }
  }

  /** Flush prefrontal to DB (called on MCP shutdown) */
  flush(): void {
    const upsert = this.db.prepare(`
      INSERT INTO memories(id, content, priority, timestamp, tags, tier, session_id, access_count, parent_id, depth)
    VALUES(@id, @content, @priority, @timestamp, @tags, @tier, @session_id, @access_count, @parent_id, @depth)
      ON CONFLICT(id) DO UPDATE SET
    priority = excluded.priority,
      access_count = excluded.access_count,
      tier = excluded.tier,
      parent_id = excluded.parent_id,
      depth = excluded.depth
        `);

    const txn = this.db.transaction((items: MemoryItem[]) => {
      for (const item of items) {
        upsert.run({
          id: item.id,
          content: item.content,
          priority: item.priority,
          timestamp: item.timestamp,
          tags: JSON.stringify(item.tags),
          tier: item.tier,
          session_id: item.sessionId ?? null,
          access_count: item.accessCount
        });
      }
    });

    txn(this.prefrontal);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core Operations
  // ─────────────────────────────────────────────────────────────────────────

  store(content: string, priority: number = 1.0, tags: string[] = [], parentId?: string, depth: number = 0): string {
    const id = randomUUID();
    const item: MemoryItem = {
      id,
      content,
      priority,
      timestamp: Date.now(),
      tags,
      tier: 'prefrontal',
      sessionId: this.sessionId,
      accessCount: 0,
      parentId,
      depth
    };

    // Write to DB immediately (don't wait for flush)
    this.db.prepare(`
      INSERT INTO memories(id, content, priority, timestamp, tags, tier, session_id, access_count, parent_id, depth)
    VALUES(?, ?, ?, ?, ?, 'prefrontal', ?, 0, ?, ?)
      `).run(id, content, priority, item.timestamp, JSON.stringify(tags), this.sessionId, parentId, depth);

    // Update vocabulary and add to vector index
    this.embedder.fitVocabulary([content]);
    this.indexMemory(id, content);

    // Auto-link to semantically similar recent memories
    this.autoLink(item);


    // Add to RAM prefrontal
    this.prefrontal.push(item);

    if (this.prefrontal.length > this.maxPrefrontal) {
      this.consolidate();
    }

    // Fission: broadcast high-value memories
    if (priority > 0.9) {
      this.fission(item);
    }

    return id;
  }

  async recall(query: string, k: number = 5): Promise<string[]> {
    // ── Stage 1: Vector search (semantic) ────────────────────────────────────
    const queryVector = await this.embedder.embed(query);
    const vectorMatches: Map<string, number> = new Map();

    const allItems = this.getAllItems();
    for (const item of allItems) {
      const itemVector = this.embedder.localEmbed(item.content);
      const hDist = HyperbolicMath.dist(queryVector, itemVector);
      let score = 1 / (1 + hDist);

      // Hierarchy Boost: if item has a parent that matches query, boost child
      if (item.parentId) {
        const parent = allItems.find(i => i.id === item.parentId);
        if (parent) {
          const parentVector = this.embedder.localEmbed(parent.content);
          const pDist = HyperbolicMath.dist(queryVector, parentVector);
          if (pDist < 0.3) score *= 1.4; // Boost child if parent is relevant
        }
      }
      vectorMatches.set(item.id, score);
    }

    // ── Stage 2: SQL scoring (priority + recency) ─────────────────────────────
    const podFindings = podNetwork.recall([]);
    const queryLower = query.toLowerCase();

    const rows = this.db.prepare(`
    SELECT *, access_count FROM memories
      ORDER BY priority DESC, timestamp DESC
      LIMIT 300
    `).all() as any[];

    const scored = rows.map(row => {
      const vectorScore = vectorMatches.get(row.id as string) ?? 0;
      const recencyScore = Math.exp(-(Date.now() - row.timestamp) / (7 * 24 * 3600 * 1000));
      const priorityScore = row.priority as number;
      const accessBonus = Math.min((row.access_count as number) * 0.05, 0.3);

      return {
        content: row.content as string,
        id: row.id as string,
        score: vectorScore * 0.5 + priorityScore * 0.25 + recencyScore * 0.15 + accessBonus * 0.1
      };
    });

    const podMatches = podFindings
      .filter(f => f.content.toLowerCase().includes(queryLower))
      .map(f => ({ content: f.content, score: 0.95 }));

    const top = [...scored, ...podMatches]
      .sort((a, b) => (b.score as number) - (a.score as number))
      .slice(0, k);

    // Increment access count for recalled items
    if (top.length > 0) {
      const ids = top.filter(t => (t as any).id).map(t => `'${(t as any).id}'`).join(',');
      if (ids) {
        this.db.exec(`UPDATE memories SET access_count = access_count + 1 WHERE id IN(${ids})`);
      }
    }

    return top.map(r => r.content);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Vector Index Helpers
  // ─────────────────────────────────────────────────────────────────────────

  // In-RAM embedding store (id → float[] vector)
  private vectorEmbeddings: Map<number, number[]> = new Map();

  private indexMemory(memoryId: string, content: string): void {
    const vector = this.embedder.localEmbed(content);
    const vid = this.nextVectorId++;
    this.vectorEmbeddings.set(vid, vector);
    this.vectorIdToMemoryId.set(vid, memoryId);
    this.memoryIdToVectorId.set(memoryId, vid);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Zettelkasten — semantic linking
  // ─────────────────────────────────────────────────────────────────────────

  private autoLink(newItem: MemoryItem): void {
    const recentRows = this.db.prepare(`
      SELECT id, content, tags FROM memories
      WHERE id != ? ORDER BY timestamp DESC LIMIT 50
      `).all(newItem.id) as any[];

    const newWords = newItem.content.toLowerCase().split(/\s+/);

    for (const row of recentRows) {
      const existingWords = (row.content as string).toLowerCase().split(/\s+/);
      const similarity = this.wordOverlap(newWords, existingWords);

      if (similarity > 0.25) {
        this.db.prepare(`
          INSERT OR IGNORE INTO memory_links(from_id, to_id, weight, type)
    VALUES(?, ?, ?, 'semantic')
      `).run(newItem.id, row.id, similarity);
      }

      // Tag-based linking
      const sharedTags = newItem.tags.filter(t =>
        JSON.parse(row.tags as string ?? '[]').includes(t)
      );
      if (sharedTags.length > 0) {
        this.db.prepare(`
          INSERT OR IGNORE INTO memory_links(from_id, to_id, weight, type)
    VALUES(?, ?, ?, 'tagged')
      `).run(newItem.id, row.id, 0.6 + sharedTags.length * 0.1);
      }
    }
  }

  /** Get a memory's connected context network */
  getNetwork(id: string, depth: number = 1): MemoryItem[] {
    const visited = new Set<string>([id]);
    const result: MemoryItem[] = [];
    let frontier = [id];

    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const fromId of frontier) {
        const links = this.db.prepare(`
          SELECT to_id FROM memory_links WHERE from_id = ? ORDER BY weight DESC LIMIT 5
      `).all(fromId) as any[];

        for (const link of links) {
          const toId = link.to_id as string;
          if (!visited.has(toId)) {
            visited.add(toId);
            next.push(toId);
            const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(toId) as any;
            if (row) result.push(this.rowToItem(row));
          }
        }
      }
      frontier = next;
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Fission: broadcast high-value discoveries
  // ─────────────────────────────────────────────────────────────────────────

  private fission(item: MemoryItem): void {
    // Promote to cortex immediately (permanently important)
    this.db.prepare(`
      UPDATE memories SET tier = 'cortex', priority = MIN(priority * 1.2, 2.0)
      WHERE id = ?
      `).run(item.id);

    // Strengthen links TO this item (makes it easier to discover via related queries)
    this.db.prepare(`
      UPDATE memory_links SET weight = MIN(weight * 1.3, 1.0) WHERE to_id = ?
      `).run(item.id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tier Management
  // ─────────────────────────────────────────────────────────────────────────

  private consolidate(): void {
    const sorted = [...this.prefrontal].sort((a, b) => b.priority - a.priority);
    const keepInRam = sorted.slice(0, Math.ceil(this.maxPrefrontal / 2));
    const toPromote = sorted.slice(Math.ceil(this.maxPrefrontal / 2));

    this.prefrontal = keepInRam;

    if (toPromote.length > 0) {
      const promoteStmt = this.db.prepare(
        `UPDATE memories SET tier = 'hippocampus' WHERE id = ? `
      );
      const txn = this.db.transaction((items: MemoryItem[]) => {
        for (const item of items) {
          promoteStmt.run(item.id);
          item.tier = 'hippocampus';
        }
      });
      txn(toPromote);
    }

    // Compact hippocampus to cortex if overfull
    const hippoCount = (this.db.prepare(
      `SELECT COUNT(*) as c FROM memories WHERE tier = 'hippocampus'`
    ).get() as any).c as number;

    if (hippoCount > this.maxHippocampus) {
      this.db.prepare(`
        UPDATE memories SET tier = 'cortex'
        WHERE tier = 'hippocampus'
        AND id IN(
        SELECT id FROM memories WHERE tier = 'hippocampus'
          ORDER BY priority DESC LIMIT ?
        )
      `).run(hippoCount - this.maxHippocampus);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────

  private wordOverlap(a: string[], b: string[]): number {
    const setA = new Set(a.filter(w => w.length > 2));
    const setB = new Set(b.filter(w => w.length > 2));
    if (setA.size === 0 || setB.size === 0) return 0;

    const intersection = [...setA].filter(x => setB.has(x));
    const union = new Set([...setA, ...setB]);
    return intersection.length / union.size;
  }

  private rowToItem(row: any): MemoryItem {
    return {
      id: row.id,
      content: row.content,
      priority: row.priority,
      timestamp: row.timestamp,
      tags: JSON.parse(row.tags ?? '[]'),
      tier: row.tier,
      sessionId: row.session_id,
      accessCount: row.access_count,
      parentId: row.parent_id,
      depth: row.depth
    };
  }

  private getAllItems(): MemoryItem[] {
    const rows = this.db.prepare('SELECT * FROM memories').all() as any[];
    return rows.map(row => this.rowToItem(row));
  }

  getStats(): MemoryStats {
    const counts = this.db.prepare(`
      SELECT tier, COUNT(*) as c FROM memories GROUP BY tier
      `).all() as any[];

    const tierMap: Record<string, number> = {};
    for (const row of counts) tierMap[row.tier] = row.c;

    const linkCount = (this.db.prepare(
      'SELECT COUNT(*) as c FROM memory_links'
    ).get() as any).c as number;

    const oldest = (this.db.prepare(
      'SELECT MIN(timestamp) as t FROM memories'
    ).get() as any).t as number | null;

    const topTagsRaw = this.db.prepare(`
      SELECT value as tag, COUNT(*) as c
      FROM memories, json_each(memories.tags)
      GROUP BY value ORDER BY c DESC LIMIT 5
      `).all() as any[];

    return {
      prefrontal: tierMap['prefrontal'] ?? 0,
      hippocampus: tierMap['hippocampus'] ?? 0,
      cortex: tierMap['cortex'] ?? 0,
      totalLinks: linkCount,
      oldestEntry: oldest,
      topTags: topTagsRaw.map(r => r.tag as string)
    };
  }

  clear(): void {
    this.prefrontal = [];
    this.db.exec('DELETE FROM memory_links; DELETE FROM memories;');
  }

  close(): void {
    this.flush();
    this.db.close();
  }
}

export const createMemoryEngine = (dbPath?: string) => new MemoryEngine(dbPath);
