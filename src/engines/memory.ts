/**
 * Memory Engine
 * 
 * Three-tier memory system with compression.
 */

export interface MemoryItem {
  content: string;
  priority: number;
  timestamp: number;
  tags: string[];
}

export class MemoryEngine {
  // Cortex: Long-term (compressed)
  private cortex: Map<string, string[]> = new Map();
  
  // Hippocampus: Medium-term (recent 24-48hr)
  private hippocampus: MemoryItem[] = [];
  
  // Prefrontal: Working memory (~7 items)
  private prefrontal: MemoryItem[] = [];
  
  private maxPrefrontal = 7;
  private maxHippocampus = 100;

  /**
   * Store a memory
   */
  store(content: string, priority: number = 1.0, tags: string[] = []): void {
    const item: MemoryItem = {
      content,
      priority,
      timestamp: Date.now(),
      tags
    };

    // Add to prefrontal (working memory)
    this.prefrontal.push(item);
    
    // Enforce capacity
    if (this.prefrontal.length > this.maxPrefrontal) {
      this.consolidate();
    }
  }

  /**
   * Consolidate prefrontal to hippocampus
   */
  private consolidate(): void {
    if (this.prefrontal.length === 0) return;

    // Sort by priority
    const sorted = [...this.prefrontal].sort((a, b) => b.priority - a.priority);
    
    // Keep top items
    const toKeep = sorted.slice(0, Math.ceil(this.maxPrefrontal / 2));
    const toPromote = sorted.slice(Math.ceil(this.maxPrefrontal / 2));
    
    this.prefrontal = toKeep;
    this.hippocampus.push(...toPromote);
    
    // Check hippocampus capacity
    if (this.hippocampus.length > this.maxHippocampus) {
      this.compressToCortex();
    }
  }

  /**
   * Compress hippocampus to cortex (long-term)
   */
  private compressToCortex(): void {
    if (this.hippocampus.length === 0) return;

    // Group by tags
    const byTag = new Map<string, string[]>();
    
    for (const item of this.hippocampus) {
      for (const tag of item.tags) {
        if (!byTag.has(tag)) {
          byTag.set(tag, []);
        }
        byTag.get(tag)!.push(item.content);
      }
    }

    // Store compressed
    for (const [tag, contents] of byTag) {
      const key = `tag_${tag}`;
      const existing = this.cortex.get(key) || [];
      this.cortex.set(key, [...existing, ...contents].slice(-50));
    }

    // Clear hippocampus
    this.hippocampus = [];
  }

  /**
   * Recall relevant memories
   */
  recall(query: string, k: number = 5): string[] {
    const results: Array<{ content: string; score: number }> = [];

    // Search prefrontal (highest priority)
    for (const item of this.prefrontal) {
      const score = this.similarity(query, item.content) * item.priority;
      results.push({ content: item.content, score });
    }

    // Search hippocampus
    for (const item of this.hippocampus) {
      const score = this.similarity(query, item.content) * item.priority * 0.7;
      results.push({ content: item.content, score });
    }

    // Search cortex
    for (const [key, contents] of this.cortex) {
      for (const content of contents) {
        const score = this.similarity(query, content) * 0.5;
        results.push({ content, score });
      }
    }

    // Sort and return top k
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(r => r.content);
  }

  /**
   * Simple similarity
   */
  private similarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    
    const intersection = [...wordsA].filter(x => wordsB.has(x));
    const union = new Set([...wordsA, ...wordsB]);
    
    return intersection.length / (union.size || 1);
  }

  /**
   * Get memory stats
   */
  getStats(): {
    prefrontal: number;
    hippocampus: number;
    cortex: number;
  } {
    return {
      prefrontal: this.prefrontal.length,
      hippocampus: this.hippocampus.length,
      cortex: this.cortex.size
    };
  }

  /**
   * Clear all memory
   */
  clear(): void {
    this.prefrontal = [];
    this.hippocampus = [];
    this.cortex.clear();
  }
}

export const createMemoryEngine = () => new MemoryEngine();
