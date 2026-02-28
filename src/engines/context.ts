/**
 * Context Engine
 * 
 * Manages context window with compression and retrieval.
 */

import { TokenOptimizer } from './token-optimizer.js';

export class ContextEngine {
  private maxTokens: number;
  private tokenOptimizer: TokenOptimizer;
  private workingContext: string[] = [];
  private compressedCache: Map<string, string[]> = new Map();

  constructor(maxTokens: number = 128000) {
    this.maxTokens = maxTokens;
    this.tokenOptimizer = new TokenOptimizer(maxTokens);
  }

  /**
   * Add content to context
   */
  add(content: string): void {
    const tokens = this.tokenize(content);
    
    // Check if we need to compress
    if (this.getTokenCount() + tokens.length > this.maxTokens * 0.8) {
      this.compress();
    }
    
    this.workingContext.push(content);
  }

  /**
   * Get relevant context for query
   */
  getContext(query: string): string[] {
    // Simple retrieval - in production use embeddings
    const relevant = this.workingContext
      .filter(c => this.similarity(query, c) > 0.3)
      .slice(-50);
    
    return relevant;
  }

  /**
   * Compress working context
   */
  private compress(): void {
    if (this.workingContext.length === 0) return;

    // Keep most recent and most relevant
    const toCompress = this.workingContext.slice(0, -10);
    const recent = this.workingContext.slice(-10);
    
    // Create compressed version (simple concatenation for now)
    const compressed = toCompress.join(' | ');
    const key = this.hashString(compressed);
    
    this.compressedCache.set(key, toCompress);
    this.workingContext = recent;
  }

  /**
   * Get total token count
   */
  private getTokenCount(): number {
    return this.workingContext.reduce((sum, c) => sum + c.length / 4, 0);
  }

  /**
   * Simple tokenization
   */
  private tokenize(content: string): string[] {
    return content.split(/\s+/);
  }

  /**
   * Simple similarity (in production use embeddings)
   */
  private similarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    
    const intersection = [...wordsA].filter(x => wordsB.has(x));
    const union = new Set([...wordsA, ...wordsB]);
    
    return intersection.length / union.size;
  }

  /**
   * Simple hash
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(36);
  }

  /**
   * Clear context
   */
  clear(): void {
    this.workingContext = [];
  }

  /**
   * Get all context
   */
  getAll(): string[] {
    return [...this.workingContext];
  }
}

export const createContextEngine = (maxTokens?: number) => 
  new ContextEngine(maxTokens);
