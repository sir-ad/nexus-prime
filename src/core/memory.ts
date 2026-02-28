/**
 * Three-Tier Brain-Inspired Memory System
 * 
 * CORTEX: Long-term memory (persistent)
 * HIPPOCAMPUS: Medium-term (recent 24-48 hours)
 * PREFRONTAL: Working memory (~7 items)
 */

import { Pattern, CortexMemory, HippocampusMemory, PrefrontalMemory, Experience } from './types.js';

export class MemorySystem {
  private cortex: CortexMemory;
  private hippocampus: HippocampusMemory;
  private prefrontal: PrefrontalMemory;
  private decayRate = 0.0001;
  private consolidationThreshold = 0.5;

  constructor(options?: {
    hippocampusWindowHours?: number;
    prefrontalMaxItems?: number;
  }) {
    // Initialize Cortex (Long-term)
    this.cortex = {
      patterns: new Map(),
      synapses: new Map(),
      semanticGraph: {
        nodes: new Map(),
        edges: new Map()
      }
    };

    // Initialize Hippocampus (Medium-term)
    this.hippocampus = {
      recentPatterns: [],
      window: options?.hippocampusWindowHours ?? 48,
      bindings: new Map()
    };

    // Initialize Prefrontal (Working)
    this.prefrontal = {
      activeContext: [],
      maxItems: options?.prefrontalMaxItems ?? 7
    };
  }

  // ==================== CORTEX OPERATIONS ====================

  /**
   * Store pattern in long-term memory (Cortex)
   */
  store(pattern: Pattern, priority: number = 1.0): void {
    this.cortex.patterns.set(pattern.id, pattern);
    this.cortex.synapses.set(pattern.id, priority);
    
    // Add to semantic graph
    this.addToGraph(pattern);
  }

  /**
   * Recall patterns from Cortex
   */
  recall(query: number[], k: number = 5): Array<{ pattern: Pattern; score: number }> {
    const scores: Array<{ pattern: Pattern; score: number }> = [];

    for (const [id, pattern] of this.cortex.patterns) {
      const similarity = this.cosineSimilarity(query, pattern.structure);
      const recency = this.computeRecency(pattern);
      const weight = this.cortex.synapses.get(id) ?? 1.0;
      
      const score = similarity * (1 + weight) * recency;
      scores.push({ pattern, score });
    }

    // Return top-k
    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /**
   * Hebbian strengthening: patterns that co-occur get stronger
   */
  hebbianStrengthen(pattern: Pattern): void {
    const related = this.findRelated(pattern);
    
    for (const rel of related) {
      const currentWeight = this.cortex.synapses.get(rel.id) ?? 1.0;
      this.cortex.synapses.set(rel.id, currentWeight + pattern.confidence * 0.01);
    }
  }

  /**
   * Decay unused patterns
   */
  decayUnused(): void {
    for (const [id] of this.cortex.synapses) {
      if (!this.wasRecentlyAccessed(id)) {
        const currentWeight = this.cortex.synapses.get(id) ?? 1.0;
        this.cortex.synapses.set(id, currentWeight * (1 - this.decayRate));
      }
    }

    // Prune very weak synapses
    for (const [id, weight] of this.cortex.synapses) {
      if (weight < 0.01) {
        this.cortex.patterns.delete(id);
        this.cortex.synapses.delete(id);
        this.removeFromGraph(id);
      }
    }
  }

  // ==================== HIPPOCAMPUS OPERATIONS ====================

  /**
   * Add pattern to recent memory (Hippocampus)
   */
  addToRecent(pattern: Pattern): void {
    this.hippocampus.recentPatterns.unshift(pattern);
    
    // Trim to window
    const maxPatterns = this.hippocampus.window * 10; // ~10 patterns per hour
    if (this.hippocampus.recentPatterns.length > maxPatterns) {
      this.hippocampus.recentPatterns = this.hippocampus.recentPatterns.slice(0, maxPatterns);
    }
  }

  /**
   * Create temporary binding between patterns
   */
  bind(patternA: string, patternB: string): void {
    this.hippocampus.bindings.set(patternA, patternB);
  }

  /**
   * Get recent patterns
   */
  getRecent(k: number = 10): Pattern[] {
    return this.hippocampus.recentPatterns.slice(0, k);
  }

  /**
   * Consolidate: Transfer important patterns from Hippocampus to Cortex
   */
  consolidate(): void {
    for (const pattern of this.hippocampus.recentPatterns) {
      if (pattern.confidence > this.consolidationThreshold) {
        // Promote to Cortex
        this.store(pattern, pattern.confidence);
        this.hebbianStrengthen(pattern);
      }
    }
    
    // Clear recent (they're now in Cortex or decayed)
    this.hippocampus.recentPatterns = [];
  }

  // ==================== PREFRONTAL OPERATIONS ====================

  /**
   * Add to working memory
   */
  addToWorking(item: string): void {
    if (!this.prefrontal.activeContext.includes(item)) {
      this.prefrontal.activeContext.unshift(item);
      
      // Enforce capacity limit (Miller's Law: ~7 items)
      if (this.prefrontal.activeContext.length > this.prefrontal.maxItems) {
        this.prefrontal.activeContext.pop();
      }
    }
  }

  /**
   * Get working memory
   */
  getWorking(): string[] {
    return [...this.prefrontal.activeContext];
  }

  /**
   * Clear working memory
   */
  clearWorking(): void {
    this.prefrontal.activeContext = [];
  }

  /**
   * Keep only specific items in working memory
   */
  retain(items: string[]): void {
    this.prefrontal.activeContext = items.filter(item => 
      this.prefrontal.activeContext.includes(item)
    );
  }

  // ==================== LEARNING ====================

  /**
   * Learn from experience
   */
  learn(experience: Experience): Pattern | null {
    // Extract pattern from experience
    const pattern: Pattern = {
      id: `pattern_${experience.agentId}_${experience.timestamp}`,
      structure: this.embedExperience(experience),
      weight: experience.value,
      confidence: experience.value,
      origin: experience.agentId,
      timestamp: experience.timestamp,
      examples: [experience.action]
    };

    if (experience.value > 0.5) {
      // High value: store prominently
      this.store(pattern, experience.value);
      this.addToRecent(pattern);
      
      // Very high value: trigger consolidation immediately
      if (experience.value > 0.9) {
        this.hebbianStrengthen(pattern);
      }
    } else {
      // Low value: just add to recent, let it decay
      this.addToRecent(pattern);
    }

    return pattern;
  }

  /**
   * Compress multiple experiences into a single pattern
   */
  compress(experiences: Experience[]): Pattern {
    if (experiences.length === 0) {
      throw new Error('No experiences to compress');
    }

    if (experiences.length === 1) {
      return this.learn(experiences[0])!;
    }

    // Average embeddings
    const embeddings = experiences.map(e => this.embedExperience(e));
    const avgEmbedding = embeddings[0].map((_, i) => 
      embeddings.reduce((sum, e) => sum + e[i], 0) / embeddings.length
    );

    // Average value
    const avgValue = experiences.reduce((sum, e) => sum + e.value, 0) / experiences.length;

    return {
      id: `compressed_${Date.now()}`,
      structure: avgEmbedding,
      weight: avgValue,
      confidence: avgValue,
      origin: 'system',
      timestamp: Date.now(),
      examples: experiences.map(e => e.action)
    };
  }

  // ==================== SEMANTIC GRAPH ====================

  private addToGraph(pattern: Pattern): void {
    this.cortex.semanticGraph.nodes.set(pattern.id, {
      id: pattern.id,
      type: 'pattern',
      embedding: pattern.structure,
      metadata: { confidence: pattern.confidence }
    });
  }

  private removeFromGraph(patternId: string): void {
    this.cortex.semanticGraph.nodes.delete(patternId);
    
    // Remove edges
    for (const [source, edges] of this.cortex.semanticGraph.edges) {
      this.cortex.semanticGraph.edges.set(
        source,
        edges.filter(e => e.target !== patternId)
      );
    }
  }

  private findRelated(pattern: Pattern): Pattern[] {
    const related: Pattern[] = [];
    
    for (const [id, p] of this.cortex.patterns) {
      if (id !== pattern.id) {
        const similarity = this.cosineSimilarity(pattern.structure, p.structure);
        if (similarity > 0.7) {
          related.push(p);
        }
      }
    }
    
    return related;
  }

  // ==================== UTILITIES ====================

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
  }

  private computeRecency(pattern: Pattern): number {
    const age = Date.now() - pattern.timestamp;
    const hour = 60 * 60 * 1000;
    return Math.exp(-age / (24 * hour)); // Decay over 24 hours
  }

  private recentlyAccessed = new Set<string>();
  
  private wasRecentlyAccessed(id: string): boolean {
    if (this.recentlyAccessed.has(id)) {
      this.recentlyAccessed.delete(id);
      return true;
    }
    return false;
  }

  markAccessed(id: string): void {
    this.recentlyAccessed.add(id);
  }

  private embedExperience(experience: Experience): number[] {
    // Simple hash-based embedding for now
    // In production, use actual embeddings
    const hash = this.hashString(`${experience.action}_${experience.outcome}`);
    const embedding: number[] = [];
    
    for (let i = 0; i < 64; i++) {
      embedding.push(((hash >> i) & 1) ? 1 : 0);
    }
    
    return embedding;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  // ==================== STATE ====================

  getCortex(): CortexMemory {
    return this.cortex;
  }

  getHippocampus(): HippocampusMemory {
    return this.hippocampus;
  }

  getPrefrontal(): PrefrontalMemory {
    return this.prefrontal;
  }
}

export const createMemory = (options?: {
  hippocampusWindowHours?: number;
  prefrontalMaxItems?: number;
}) => new MemorySystem(options);
