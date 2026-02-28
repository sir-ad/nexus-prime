/**
 * Token Optimizer Engine
 * 
 * Intelligent token allocation using AdaptiveKVMerge principles.
 */

export class TokenOptimizer {
  private maxTokens: number;
  private qualityThreshold: number = 0.64;
  private compressionHistory: Map<string, number> = new Map();

  constructor(maxTokens: number = 128000) {
    this.maxTokens = maxTokens;
  }

  /**
   * Assess task complexity (0-1)
   */
  assessComplexity(task: string): number {
    // Simple heuristic-based assessment
    const indicators = {
      simple: ['what', 'when', 'who', 'where', 'is', 'are', '?', 'list'],
      complex: ['build', 'create', 'design', 'implement', 'develop', 'explain why', 'analyze']
    };

    let score = 0.5;
    const taskLower = task.toLowerCase();

    for (const word of indicators.simple) {
      if (taskLower.includes(word)) score -= 0.1;
    }
    for (const word of indicators.complex) {
      if (taskLower.includes(word)) score += 0.15;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Determine compression ratio based on complexity
   */
  getCompressionRatio(complexity: number): number {
    if (complexity < 0.3) return 8.0;      // Aggressive for simple
    if (complexity < 0.7) return 5.0;      // Moderate for normal
    return 3.0;                               // Conservative for complex
  }

  /**
   * Optimize token allocation
   */
  optimize(context: string[], task: string): {
    tokens: number;
    ratio: number;
    strategy: string;
  } {
    const complexity = this.assessComplexity(task);
    const ratio = this.getCompressionRatio(complexity);
    
    // Estimate tokens needed
    const baseTokens = context.reduce((sum, c) => sum + c.length / 4, 0);
    const optimizedTokens = Math.floor(baseTokens / ratio);

    return {
      tokens: Math.min(optimizedTokens, this.maxTokens),
      ratio,
      strategy: complexity < 0.3 ? 'aggressive' : 
                complexity < 0.7 ? 'moderate' : 'conservative'
    };
  }

  /**
   * Track compression for learning
   */
  trackCompression(taskType: string, quality: number): void {
    this.compressionHistory.set(taskType, quality);
  }

  /**
   * Get average quality for a task type
   */
  getAverageQuality(taskType: string): number {
    const history = this.compressionHistory.get(taskType);
    return history || 0.5;
  }
}

export const createTokenOptimizer = (maxTokens?: number) => 
  new TokenOptimizer(maxTokens);

// ===== Advanced: SLERP-based compression (from AdaptiveKVMerge) =====

export class SLERPCompressor {
  /**
   * SLERP interpolation between two vectors
   */
  slerp(v1: number[], v2: number[], t: number): number[] {
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
   * Compress layers using SLERP
   */
  compressLayers(layers: number[][], strategy: 'aggressive' | 'moderate' | 'conservative' = 'moderate'): {
    compressed: number[][];
    ratio: number;
  } {
    const t = strategy === 'aggressive' ? 0.7 : strategy === 'moderate' ? 0.5 : 0.3;
    
    const compressed: number[][] = [];
    
    for (let i = 1; i < layers.length; i += 2) {
      if (i < layers.length) {
        compressed.push(this.slerp(layers[i], layers[i - 1], t));
      }
    }
    
    return {
      compressed,
      ratio: layers.length / (compressed.length || 1)
    };
  }
  
  private magnitude(v: number[]): number {
    return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  }
  
  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, x, i) => sum + x * (b[i] || 0), 0);
  }
}

export const createSLERPCompressor = () => new SLERPCompressor();
