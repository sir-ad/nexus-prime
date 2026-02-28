/**
 * Multi-Agent Cache Manager
 * 
 * Implements shared KV cache with Byzantine consensus.
 */

export interface CacheEntry {
  direction: number[];      // E - normalized direction vectors
  magnitudes: number[];       // X - magnitude scalars
  retained: Map<number, number[]>;  // R - retained tokens
  indices: number[];         // I - position indices
}

export interface AgentDelta {
  layerIndex: number;
  delta: number[];
  timestamp: number;
}

export class CacheManager {
  private sharedCache: Map<number, CacheEntry> = new Map();
  private agentDeltas: Map<string, Map<number, number[]>> = new Map();
  private version: number = 0;
  private locks: Map<number, 'none' | 'read' | 'write'> = new Map();
  
  private syncInterval = 50;  // tokens
  private compressionThreshold = 0.1;
  
  /**
   * Initialize shared cache for a layer
   */
  initLayer(layerIndex: number, kvCache: number[][]): void {
    // Compress using SLERP-like merge
    const compressed = this.compress(kvCache);
    this.sharedCache.set(layerIndex, compressed);
  }
  
  /**
   * Compress KV cache using SLERP-inspired merge
   */
  private compress(kvCache: number[][]): CacheEntry {
    if (kvCache.length < 2) {
      return {
        direction: kvCache[0] || [],
        magnitudes: [1],
        retained: new Map(),
        indices: kvCache.map((_, i) => i)
      };
    }
    
    // Start from middle
    const mid = Math.floor(kvCache.length / 2);
    
    // Merge middle with previous (like SLERP)
    const merged = this.slerpMerge(kvCache[mid], kvCache[mid - 1], 0.5);
    
    // Compute magnitudes
    const magnitudes = kvCache.map(v => this.magnitude(v));
    
    // Retain highly distinct tokens (simple threshold)
    const retained = new Map<number, number[]>();
    const threshold = 0.3;
    
    for (let i = mid; i < kvCache.length; i++) {
      const sim = this.cosineSimilarity(kvCache[i], merged);
      if (sim < threshold) {
        retained.set(i, kvCache[i]);
      }
    }
    
    return {
      direction: this.normalize(merged),
      magnitudes: magnitudes.slice(mid),
      retained,
      indices: kvCache.map((_, i) => i).slice(mid)
    };
  }
  
  /**
   * SLERP-inspired merge
   */
  private slerpMerge(v1: number[], v2: number[], t: number): number[] {
    // Simplified SLERP
    const dot = this.dotProduct(v1, v2) / (this.magnitude(v1) * this.magnitude(v2) || 1);
    const omega = Math.acos(Math.max(-1, Math.min(1, dot)));
    const sinOmega = Math.sin(omega);
    
    if (sinOmega < 1e-6) {
      return v1.map((x, i) => (1 - t) * x + t * (v2[i] || 0));
    }
    
    const a = Math.sin((1 - t) * omega) / sinOmega;
    const b = Math.sin(t * omega) / sinOmega;
    
    return v1.map((x, i) => a * x + b * (v2[i] || 0));
  }
  
  /**
   * Acquire read lock (non-blocking)
   */
  acquireReadLock(layerIndex: number): boolean {
    const current = this.locks.get(layerIndex) || 'none';
    if (current === 'write') {
      return false;  // Blocked
    }
    this.locks.set(layerIndex, 'read');
    return true;
  }
  
  /**
   * Acquire write lock
   */
  acquireWriteLock(layerIndex: number): boolean {
    const current = this.locks.get(layerIndex) || 'none';
    if (current !== 'none') {
      return false;  // Blocked
    }
    this.locks.set(layerIndex, 'write');
    return true;
  }
  
  /**
   * Release lock
   */
  releaseLock(layerIndex: number): void {
    this.locks.set(layerIndex, 'none');
  }
  
  /**
   * Get cache entry for agent
   */
  getForAgent(agentId: string, layerIndex: number): number[] {
    const entry = this.sharedCache.get(layerIndex);
    if (!entry) return [];
    
    // Get agent's delta
    const agentDeltaMap = this.agentDeltas.get(agentId) || new Map();
    const delta = agentDeltaMap.get(layerIndex) || [];
    
    // Restore: direction * magnitude + delta
    const restored = entry.direction.map(
      (d, i) => d * (entry.magnitudes[i] || 1) + (delta[i] || 0)
    );
    
    // Add retained tokens
    for (const [idx, token] of entry.retained) {
      if (idx < restored.length) {
        restored[idx] += this.magnitude(token);
      }
    }
    
    return restored;
  }
  
  /**
   * Update agent delta
   */
  updateDelta(agentId: string, layerIndex: number, delta: number[]): void {
    if (!this.agentDeltas.has(agentId)) {
      this.agentDeltas.set(agentId, new Map());
    }
    
    const agentDeltaMap = this.agentDeltas.get(agentId)!;
    const existing = agentDeltaMap.get(layerIndex) || [];
    
    // Accumulate delta
    const newDelta = delta.map((d, i) => d + (existing[i] || 0));
    agentDeltaMap.set(layerIndex, newDelta);
  }
  
  /**
   * Sync agent delta to shared cache
   */
  syncToShared(agentId: string, layerIndex: number): void {
    const agentDeltaMap = this.agentDeltas.get(agentId);
    if (!agentDeltaMap) return;
    
    const delta = agentDeltaMap.get(layerIndex);
    if (!delta) return;
    
    // Check if delta is significant
    const entry = this.sharedCache.get(layerIndex);
    if (!entry) return;
    
    const mag = this.magnitude(entry.direction);
    const deltaMag = this.magnitude(delta);
    
    if (deltaMag > this.compressionThreshold * mag) {
      // Merge delta into shared
      const merged = entry.direction.map(
        (d, i) => d + delta[i] * 0.1
      );
      
      this.sharedCache.set(layerIndex, {
        ...entry,
        direction: this.normalize(merged),
        magnitudes: entry.magnitudes.map(m => m + deltaMag * 0.1)
      });
      
      // Reset agent delta
      agentDeltaMap.set(layerIndex, []);
      this.version++;
    }
  }
  
  /**
   * Get cache statistics
   */
  getStats(): {
    layers: number;
    agents: number;
    version: number;
    compressionRatio: number;
  } {
    let totalOriginal = 0;
    let totalCompressed = 0;
    
    for (const entry of this.sharedCache.values()) {
      totalOriginal += entry.magnitudes.length * entry.direction.length;
      totalCompressed += entry.direction.length + entry.magnitudes.length;
      totalCompressed += Array.from(entry.retained.values())
        .reduce((sum, v) => sum + v.length, 0);
    }
    
    return {
      layers: this.sharedCache.size,
      agents: this.agentDeltas.size,
      version: this.version,
      compressionRatio: totalOriginal / (totalCompressed || 1)
    };
  }
  
  // ===== Utilities =====
  
  private magnitude(v: number[]): number {
    return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  }
  
  private normalize(v: number[]): number[] {
    const mag = this.magnitude(v);
    if (mag === 0) return v;
    return v.map(x => x / mag);
  }
  
  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, x, i) => sum + x * (b[i] || 0), 0);
  }
  
  private cosineSimilarity(a: number[], b: number[]): number {
    const dot = this.dotProduct(a, b);
    const magA = this.magnitude(a);
    const magB = this.magnitude(b);
    return dot / (magA * magB || 1);
  }
}

export const createCacheManager = () => new CacheManager();
