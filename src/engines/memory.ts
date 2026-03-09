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
  entropy: number; // 0.0 (fresh) to 1.0 (dead/noise)
  mass: number;    // Weight of importance (gravity)
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

export interface MemoryEntityReference {
  type: 'session' | 'run' | 'skill' | 'workflow';
  id: string;
}

export interface MemorySnapshot {
  id: string;
  tier: MemoryItem['tier'];
  priority: number;
  timestamp: number;
  tags: string[];
  excerpt: string;
  parentId?: string;
  depth?: number;
  accessCount: number;
  linkCount: number;
  sessionId?: string;
  related: MemoryEntityReference[];
}

export interface MemoryDetail extends MemorySnapshot {
  content: string;
  lineage: MemorySnapshot[];
  linkedMemories: MemorySnapshot[];
  timeline: MemorySnapshot[];
}

export interface MemoryNetworkNode {
  id: string;
  label: string;
  entityType: 'memory' | 'session' | 'run' | 'skill' | 'workflow';
  tier?: MemoryItem['tier'];
  priority?: number;
  timestamp?: number;
}

export interface MemoryNetworkLink {
  source: string;
  target: string;
  type: 'semantic' | 'temporal' | 'tagged' | 'lineage' | 'artifact-derived';
  weight: number;
}

export interface MemoryNetworkSnapshot {
  focusId?: string;
  nodes: MemoryNetworkNode[];
  links: MemoryNetworkLink[];
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
        depth       INTEGER DEFAULT 0,
        entropy     REAL NOT NULL DEFAULT 0.0,
        mass        REAL NOT NULL DEFAULT 1.0
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
    if (!columns.includes('entropy')) {
      this.db.exec("ALTER TABLE memories ADD COLUMN entropy REAL NOT NULL DEFAULT 0.0");
    }
    if (!columns.includes('mass')) {
      this.db.exec("ALTER TABLE memories ADD COLUMN mass REAL NOT NULL DEFAULT 1.0");
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
        accessCount: row.access_count,
        entropy: row.entropy ?? 0,
        mass: row.mass ?? 1.0
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
    try {
      const upsert = this.db.prepare(`
        INSERT INTO memories(id, content, priority, timestamp, tags, tier, session_id, access_count, parent_id, depth)
      VALUES(@id, @content, @priority, @timestamp, @tags, @tier, @session_id, @access_count, @parent_id, @depth)
        ON CONFLICT(id) DO UPDATE SET
      priority = excluded.priority,
        access_count = excluded.access_count,
        tier = excluded.tier,
        parent_id = excluded.parent_id,
        depth = excluded.depth,
        entropy = excluded.entropy,
        mass = excluded.mass
          `);

      const txn = this.db.transaction((items: MemoryItem[]) => {
        for (const item of items) {
          // Sanitize fields to prevent type errors
          upsert.run({
            id: String(item.id),
            content: String(item.content),
            priority: Number(item.priority) || 0,
            timestamp: Number(item.timestamp) || Date.now(),
            tags: JSON.stringify(Array.isArray(item.tags) ? item.tags : []),
            tier: String(item.tier || 'prefrontal'),
            session_id: item.sessionId ? String(item.sessionId) : null,
            access_count: Number(item.accessCount) || 0,
            parent_id: item.parentId ? String(item.parentId) : null,
            depth: Number(item.depth) || 0,
            entropy: Number(item.entropy) || 0,
            mass: Number(item.mass) || 1.0
          });
        }
      });

      txn(this.prefrontal);
    } catch (err) {
      console.error('[MemoryEngine] flush() error:', err);
    }
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
      depth,
      entropy: 0.0,
      mass: priority
    };

    // Write to DB immediately (don't wait for flush)
    this.db.prepare(`
      INSERT INTO memories(id, content, priority, timestamp, tags, tier, session_id, access_count, parent_id, depth, entropy, mass)
    VALUES(?, ?, ?, ?, ?, 'prefrontal', ?, 0, ?, ?, 0.0, ?)
      `).run(id, content, priority, item.timestamp, JSON.stringify(tags), this.sessionId, parentId, depth, priority);

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
      const entropyPenalty = 1 - (row.entropy as number ?? 0);
      const massBoost = (row.mass as number ?? 1.0) * 0.2;

      return {
        content: row.content as string,
        id: row.id as string,
        score: (vectorScore * 0.5 + priorityScore * 0.25 + recencyScore * 0.15 + accessBonus * 0.1 + massBoost) * entropyPenalty
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
      UPDATE memories SET tier = 'cortex', priority = MIN(priority * 1.2, 2.0), mass = MIN(mass * 1.5, 5.0)
      WHERE id = ?
      `).run(item.id);

    // Broadcast via POD network if priority is exceptionally high
    if (item.priority > 0.95) {
      podNetwork.publish(
        'NexusAgent',
        item.content,
        item.priority,
        [...item.tags, '#fission']
      );
    }

    // Strengthen links TO this item (makes it easier to discover via related queries)
    this.db.prepare(`
      UPDATE memory_links SET weight = MIN(weight * 1.3, 1.0) WHERE to_id = ?
      `).run(item.id);
  }

  /** Periodic cooling cycle: increases entropy and decays priority */
  coolDown(): void {
    this.db.exec(`
      UPDATE memories
      SET entropy = MIN(entropy + 0.05, 1.0),
          priority = priority * 0.95
      WHERE tier != 'cortex'
    `);

    // Force flush high entropy items (this will promote/demote based on priority)
    this.consolidate();
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
      depth: row.depth,
      entropy: row.entropy ?? 0,
      mass: row.mass ?? 1.0
    };
  }

  private getAllItems(): MemoryItem[] {
    const rows = this.db.prepare('SELECT * FROM memories').all() as any[];
    return rows.map(row => this.rowToItem(row));
  }

  private toSnapshot(item: MemoryItem): MemorySnapshot {
    return {
      id: item.id,
      tier: item.tier,
      priority: item.priority,
      timestamp: item.timestamp,
      tags: item.tags,
      excerpt: item.content.length > 140 ? `${item.content.slice(0, 137)}...` : item.content,
      parentId: item.parentId,
      depth: item.depth,
      accessCount: item.accessCount,
      linkCount: this.getLinkCount(item.id),
      sessionId: item.sessionId,
      related: this.extractEntityReferences(item),
    };
  }

  private getLinkCount(id: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as c FROM memory_links WHERE from_id = ? OR to_id = ?
    `).get(id, id) as { c?: number } | undefined;
    return row?.c ?? 0;
  }

  private getLinkedMemories(id: string): MemoryItem[] {
    const rows = this.db.prepare(`
      SELECT m.*
      FROM memory_links l
      JOIN memories m ON m.id = l.to_id
      WHERE l.from_id = ?
      ORDER BY l.weight DESC, m.priority DESC
      LIMIT 12
    `).all(id) as any[];
    return rows.map((row) => this.rowToItem(row));
  }

  private buildLineage(item: MemoryItem): MemorySnapshot[] {
    const lineage: MemorySnapshot[] = [];
    let currentParentId = item.parentId;

    while (currentParentId) {
      const parentRow = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(currentParentId) as any;
      if (!parentRow) break;
      const parentItem = this.rowToItem(parentRow);
      lineage.unshift(this.toSnapshot(parentItem));
      currentParentId = parentItem.parentId;
    }

    lineage.push(this.toSnapshot(item));
    return lineage;
  }

  private buildTimeline(item: MemoryItem): MemorySnapshot[] {
    const lineage = this.buildLineage(item);
    const rootId = lineage[0]?.id ?? item.id;
    const related = this.getAllItems().filter((candidate) => {
      if (candidate.id === item.id) return true;
      if (candidate.sessionId && candidate.sessionId === item.sessionId) return true;
      return this.belongsToLineage(candidate, rootId);
    });

    return related
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, 24)
      .map((candidate) => this.toSnapshot(candidate));
  }

  private belongsToLineage(item: MemoryItem, rootId: string): boolean {
    let current: MemoryItem | undefined = item;
    while (current?.parentId) {
      if (current.parentId === rootId) return true;
      const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(current.parentId) as any;
      current = row ? this.rowToItem(row) : undefined;
    }
    return item.id === rootId;
  }

  private extractEntityReferences(item: MemoryItem): MemoryEntityReference[] {
    const refs: MemoryEntityReference[] = [];
    const patterns: Array<[MemoryEntityReference['type'], RegExp]> = [
      ['run', /\bexec_[a-z0-9_-]+\b/gi],
      ['skill', /\bskill_[a-z0-9_-]+\b/gi],
      ['workflow', /\bworkflow_[a-z0-9_-]+\b/gi],
    ];

    if (item.sessionId) {
      refs.push({ type: 'session', id: item.sessionId });
    }

    for (const [type, pattern] of patterns) {
      for (const match of item.content.match(pattern) ?? []) {
        refs.push({ type, id: match });
      }
    }

    return dedupeReferences(refs);
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

  snapshot(limit: number = 100): MemoryItem[] {
    const rows = this.db.prepare(`
      SELECT * FROM memories
      ORDER BY priority DESC, timestamp DESC
      LIMIT ?
    `).all(limit) as any[];
    return rows.map(row => this.rowToItem(row));
  }

  listSnapshots(limit: number = 80, filters: {
    tier?: MemoryItem['tier'];
    tag?: string;
    recencyMs?: number;
    linkedType?: MemoryEntityReference['type'];
  } = {}): MemorySnapshot[] {
    const now = Date.now();
    return this.getAllItems()
      .filter((item) => !filters.tier || item.tier === filters.tier)
      .filter((item) => !filters.tag || item.tags.includes(filters.tag))
      .filter((item) => !filters.recencyMs || now - item.timestamp <= filters.recencyMs)
      .map((item) => this.toSnapshot(item))
      .filter((item) => !filters.linkedType || item.related.some((reference) => reference.type === filters.linkedType))
      .sort((a, b) => (b.priority - a.priority) || (b.timestamp - a.timestamp))
      .slice(0, Math.max(limit, 1));
  }

  getSnapshot(id: string): MemorySnapshot | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return this.toSnapshot(this.rowToItem(row));
  }

  getDetail(id: string): MemoryDetail | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    const item = this.rowToItem(row);
    const linkedMemories = this.getLinkedMemories(item.id).slice(0, 8).map((linked) => this.toSnapshot(linked));

    return {
      ...this.toSnapshot(item),
      content: item.content,
      lineage: this.buildLineage(item),
      linkedMemories,
      timeline: this.buildTimeline(item),
    };
  }

  getNetworkSnapshot(id?: string, depth: number = 2, limit: number = 18): MemoryNetworkSnapshot {
    const focus = id ? this.getDetail(id) : undefined;
    const baseItems = focus ? [focus, ...focus.linkedMemories] : this.listSnapshots(limit);
    const allItems = this.getAllItems();
    const itemMap = new Map(allItems.map((item) => [item.id, item]));
    const nodes = new Map<string, MemoryNetworkNode>();
    const links: MemoryNetworkLink[] = [];

    const pushMemoryNode = (snapshot: MemorySnapshot) => {
      nodes.set(snapshot.id, {
        id: snapshot.id,
        label: snapshot.excerpt,
        entityType: 'memory',
        tier: snapshot.tier,
        priority: snapshot.priority,
        timestamp: snapshot.timestamp,
      });
    };

    for (const snapshot of baseItems.slice(0, limit)) {
      pushMemoryNode(snapshot);

      if (snapshot.parentId) {
        const parent = itemMap.get(snapshot.parentId);
        if (parent) {
          const parentSnapshot = this.toSnapshot(parent);
          pushMemoryNode(parentSnapshot);
          links.push({
            source: parentSnapshot.id,
            target: snapshot.id,
            type: 'lineage',
            weight: 1,
          });
        }
      }

      const dbLinks = this.db.prepare(`
        SELECT to_id, weight, type FROM memory_links WHERE from_id = ? ORDER BY weight DESC LIMIT ?
      `).all(snapshot.id, depth * 4) as Array<{ to_id: string; weight: number; type: MemoryLink['type'] }>;
      for (const link of dbLinks) {
        const target = itemMap.get(link.to_id);
        if (!target) continue;
        pushMemoryNode(this.toSnapshot(target));
        links.push({
          source: snapshot.id,
          target: target.id,
          type: link.type,
          weight: link.weight,
        });
      }

      for (const reference of snapshot.related) {
        const referenceId = `${reference.type}:${reference.id}`;
        if (!nodes.has(referenceId)) {
          nodes.set(referenceId, {
            id: referenceId,
            label: reference.id,
            entityType: reference.type,
          });
        }
        links.push({
          source: snapshot.id,
          target: referenceId,
          type: 'artifact-derived',
          weight: 0.7,
        });
      }
    }

    return {
      focusId: focus?.id,
      nodes: [...nodes.values()].slice(0, limit * 3),
      links: dedupeLinks(links).slice(0, limit * 6),
    };
  }

  clear(): void {
    this.prefrontal = [];
    this.db.exec('DELETE FROM memory_links; DELETE FROM memories;');
  }

  /**
   * Query memories by tag using direct SQL — precise, no fuzzy matching.
   * Returns memories that contain ANY of the specified tags.
   */
  queryByTags(tags: string[], limit: number = 20): MemoryItem[] {
    if (tags.length === 0) return [];
    const placeholders = tags.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT DISTINCT m.* FROM memories m, json_each(m.tags) jt
      WHERE jt.value IN (${placeholders})
      ORDER BY m.priority DESC, m.timestamp DESC
      LIMIT ?
    `).all(...tags, limit) as any[];
    return rows.map(row => this.rowToItem(row));
  }

  close(): void {
    this.flush();
    this.db.close();
  }
}

export const createMemoryEngine = (dbPath?: string) => new MemoryEngine(dbPath);

function dedupeReferences(references: MemoryEntityReference[]): MemoryEntityReference[] {
  const seen = new Set<string>();
  const result: MemoryEntityReference[] = [];
  for (const reference of references) {
    const key = `${reference.type}:${reference.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reference);
  }
  return result;
}

function dedupeLinks(links: MemoryNetworkLink[]): MemoryNetworkLink[] {
  const seen = new Set<string>();
  const result: MemoryNetworkLink[] = [];
  for (const link of links) {
    const key = `${link.source}:${link.target}:${link.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }
  return result;
}
