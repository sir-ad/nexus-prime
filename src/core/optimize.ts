/**
 * Attention Economics & Token Optimization
 * 
 * Intelligent token allocation that mimics brain attention.
 * Compresses familiar patterns, expands novel ones.
 */

export class AttentionEconomics {
  private totalAttention: number;
  private allocations: Map<string, number> = new Map();
  private history: Map<string, number[]> = new Map();

  constructor(totalAttention: number = 1.0) {
    this.totalAttention = totalAttention;
  }

  /**
   * Allocate attention across agents based on multiple factors
   */
  allocate(agents: Array<{
    id: string;
    performance: number;
    reliability: number;
    urgency: number;
    potential: number;
  }>): Map<string, number> {
    const scores: Map<string, number> = new Map();

    for (const agent of agents) {
      // Composite score
      const score = 
        0.4 * agent.performance +
        0.2 * agent.reliability +
        0.2 * agent.urgency +
        0.2 * agent.potential;

      scores.set(agent.id, score);
    }

    // Normalize to conserve attention
    const total = Array.from(scores.values()).reduce((a, b) => a + b, 0);
    
    if (total === 0) {
      return this.allocations;
    }

    for (const [id, score] of scores) {
      const normalized = (score / total) * this.totalAttention;
      this.allocations.set(id, normalized);
    }

    return this.allocations;
  }

  /**
   * Get current allocation for an agent
   */
  getAllocation(agentId: string): number {
    return this.allocations.get(agentId) ?? 0;
  }

  /**
   * Record agent performance for future allocation
   */
  recordPerformance(agentId: string, value: number): void {
    if (!this.history.has(agentId)) {
      this.history.set(agentId, []);
    }
    
    const agentHistory = this.history.get(agentId)!;
    agentHistory.push(value);
    
    // Keep only last 100 records
    if (agentHistory.length > 100) {
      agentHistory.shift();
    }
  }

  /**
   * Get average performance
   */
  getAveragePerformance(agentId: string): number {
    const history = this.history.get(agentId);
    if (!history || history.length === 0) {
      return 0.5; // Default
    }
    
    return history.reduce((a, b) => a + b, 0) / history.length;
  }
}

// ==================== TOKEN OPTIMIZER ====================

export class TokenOptimizer {
  private compressionDictionary: Map<string, string> = new Map();
  private familiarityScores: Map<string, number> = new Map();

  constructor(private maxTokens: number = 128000) {}

  /**
   * Optimize token allocation for a task
   */
  optimize(
    task: string,
    context: string[]
  ): {
    tokens: number;
    strategy: 'compress' | 'expand' | 'standard';
    breakdown: Array<{ part: string; tokens: number }>;
  } {
    // Decompose task into subtasks
    const subtasks = this.decompose(task);
    
    const breakdown: Array<{ part: string; tokens: number }> = [];
    let totalTokens = 0;

    for (const subtask of subtasks) {
      const complexity = this.estimateComplexity(subtask);
      const relevance = this.computeRelevance(context, subtask);
      
      let tokens: number;
      let strategy: 'compress' | 'expand' | 'standard';

      // Determine strategy
      const isFamiliar = this.isFamiliar(subtask);
      const isNovel = this.isNovel(subtask);

      if (isFamiliar) {
        // Compress: familiar pattern, use dictionary
        tokens = Math.floor(this.maxTokens * complexity * relevance * 0.1);
        strategy = 'compress';
      } else if (isNovel) {
        // Expand: novel situation, explore more
        tokens = Math.floor(this.maxTokens * complexity * relevance * 2);
        strategy = 'expand';
      } else {
        // Standard allocation
        tokens = Math.floor(this.maxTokens * complexity * relevance);
        strategy = 'standard';
      }

      breakdown.push({ part: subtask, tokens });
      totalTokens += tokens;
    }

    return {
      tokens: Math.min(totalTokens, this.maxTokens),
      strategy: totalTokens < this.maxTokens * 0.5 ? 'compress' : 
                totalTokens > this.maxTokens * 0.8 ? 'expand' : 'standard',
      breakdown
    };
  }

  /**
   * Compress tokens using learned dictionary
   */
  compress(text: string): string {
    // Simple compression: replace known phrases
    let compressed = text;
    
    for (const [phrase, token] of this.compressionDictionary) {
      compressed = compressed.replace(new RegExp(phrase, 'g'), token);
    }

    return compressed;
  }

  /**
   * Expand compressed tokens back to text
   */
  expand(compressed: string): string {
    let expanded = compressed;
    
    for (const [token, phrase] of this.compressionDictionary) {
      expanded = expanded.replace(new RegExp(token, 'g'), phrase);
    }

    return expanded;
  }

  /**
   * Update compression dictionary
   */
  updateDictionary(phrase: string, token: string): void {
    this.compressionDictionary.set(phrase, token);
  }

  /**
   * Speculate: generate variations for novel situations
   */
  speculate(text: string, n: number = 3): string[] {
    // In production, use actual LLM for speculation
    // For now, return variations
    return Array.from({ length: n }, (_, i) => `${text}_variant_${i}`);
  }

  /**
   * Rank speculations by potential
   */
  rankByPotential(variations: string[]): string[] {
    // Simple ranking based on familiarity
    return variations.sort((a, b) => {
      const scoreA = this.familiarityScores.get(a) ?? 0;
      const scoreB = this.familiarityScores.get(b) ?? 0;
      return scoreB - scoreA;
    });
  }

  // ==================== HELPERS ====================

  private decompose(task: string): string[] {
    // Simple decomposition by splitting on common separators
    return task.split(/[,;]| and | then /).map(s => s.trim()).filter(Boolean);
  }

  private estimateComplexity(subtask: string): number {
    // Simple heuristic: longer = more complex
    const words = subtask.split(/\s+/).length;
    return Math.min(1, words / 20);
  }

  private computeRelevance(context: string[], subtask: string): number {
    // Simple word overlap
    const subtaskWords = new Set(subtask.toLowerCase().split(/\s+/));
    let overlap = 0;
    
    for (const ctx of context) {
      const ctxWords = ctx.toLowerCase().split(/\s+/);
      for (const word of ctxWords) {
        if (subtaskWords.has(word)) {
          overlap++;
        }
      }
    }

    return Math.min(1, overlap / Math.max(subtaskWords.size, 1));
  }

  private isFamiliar(subtask: string): boolean {
    const score = this.familiarityScores.get(subtask) ?? 0;
    return score > 0.7;
  }

  private isNovel(subtask: string): boolean {
    const score = this.familiarityScores.get(subtask) ?? 0;
    return score < 0.3;
  }

  markFamiliar(subtask: string): void {
    const current = this.familiarityScores.get(subtask) ?? 0;
    this.familiarityScores.set(subtask, Math.min(1, current + 0.1));
  }

  markNovel(subtask: string): void {
    const current = this.familiarityScores.get(subtask) ?? 0;
    this.familiarityScores.set(subtask, Math.max(0, current - 0.1));
  }
}

// ==================== INFINITE CONTEXT ====================

export class InfiniteContext {
  private index: Map<string, string[]> = new Map();
  private attentionRouter: Map<string, number> = new Map();

  constructor(private attentionBudget: number = 100) {}

  /**
   * Index content for retrieval
   */
  indexContent(key: string, content: string[]): void {
    this.index.set(key, content);
  }

  /**
   * Think: retrieve relevant context regardless of "distance"
   */
  think(query: string, maxItems?: number): string[] {
    const queryWords = new Set(query.toLowerCase().split(/\s+/));
    const scores: Array<{ key: string; score: number }> = [];

    for (const [key, content] of this.index) {
      let score = 0;
      
      for (const item of content) {
        const itemWords = item.toLowerCase().split(/\s+/);
        for (const word of itemWords) {
          if (queryWords.has(word)) {
            score++;
          }
        }
      }

      // Weight by attention
      const attention = this.attentionRouter.get(key) ?? 1;
      scores.push({ key, score: score * attention });
    }

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    // Retrieve top-k
    const limit = maxItems ?? Math.min(this.attentionBudget, scores.length);
    const results: string[] = [];

    for (let i = 0; i < limit; i++) {
      const content = this.index.get(scores[i].key);
      if (content) {
        results.push(...content);
      }
    }

    return results;
  }

  /**
   * Update attention weights
   */
  updateAttention(key: string, value: number): void {
    this.attentionRouter.set(key, value);
  }
}

// ==================== FACTORY ====================

export const createAttentionEconomics = (totalAttention?: number) => 
  new AttentionEconomics(totalAttention);

export const createTokenOptimizer = (maxTokens?: number) => 
  new TokenOptimizer(maxTokens);

export const createInfiniteContext = (attentionBudget?: number) => 
  new InfiniteContext(attentionBudget);
