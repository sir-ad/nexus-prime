/**
 * Meta-Learner for Adaptive Compression
 * 
 * Implements adaptive interpolation and token retention.
 */

export interface CompressionFeatures {
  entropy: number;
  taskEmbedding: number[];
  layerDepth: number;
  magnitudeRatio: number;
  cosineSimilarity: number;
}

export class AdaptiveInterpolator {
  private w1: number = 1.0;
  private w2: number = 1.0;
  private b: number = 0.0;
  
  /**
   * Adaptive interpolation: t^{l,l-1} = σ(w1 * mag_ratio + w2 * cos_sim + b)
   * Bounds t to [0.3, 0.7]
   */
  computeT(features: CompressionFeatures): number {
    const { magnitudeRatio, cosineSimilarity } = features;
    
    // Compute t
    const raw = this.w1 * magnitudeRatio + this.w2 * cosineSimilarity + this.b;
    const t = 1 / (1 + Math.exp(-raw));  // Sigmoid
    
    // Bound to [0.3, 0.7]
    return Math.max(0.3, Math.min(0.7, t));
  }
  
  /**
   * Update weights (simple gradient descent)
   */
  update(features: CompressionFeatures, targetT: number, learningRate: number = 0.01): void {
    const predictedT = this.computeT(features);
    const error = targetT - predictedT;
    
    // Simple weight update
    this.w1 += learningRate * error * features.magnitudeRatio;
    this.w2 += learningRate * error * features.cosineSimilarity;
    this.b += learningRate * error;
  }
  
  /**
   * Extract features from layer outputs
   */
  extractFeatures(
    attentionMatrix: number[][],
    taskQuery: string,
    layerIndex: number,
    totalLayers: number,
    currentLayer: number[],
    previousLayer: number[]
  ): CompressionFeatures {
    // Entropy of attention matrix
    const entropy = this.computeEntropy(attentionMatrix);
    
    // Simple task embedding (in production use BERT)
    const taskEmbedding = this.simpleEmbedding(taskQuery);
    
    // Layer depth
    const layerDepth = layerIndex / totalLayers;
    
    // Magnitude ratio
    const magRatio = this.magnitudeRatio(currentLayer, previousLayer);
    
    // Cosine similarity
    const cosSim = this.cosineSimilarity(currentLayer, previousLayer);
    
    return {
      entropy,
      taskEmbedding,
      layerDepth,
      magnitudeRatio: magRatio,
      cosineSimilarity: cosSim
    };
  }
  
  private computeEntropy(matrix: number[][]): number {
    // Flatten and compute entropy
    const flat = matrix.flat();
    const sum = flat.reduce((a, b) => a + b, 0);
    const probs = flat.map(x => x / (sum || 1));
    
    let entropy = 0;
    for (const p of probs) {
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }
    return entropy;
  }
  
  private simpleEmbedding(text: string): number[] {
    // Simple hash-based embedding
    const embedding = new Array(384).fill(0);
    for (let i = 0; i < text.length; i++) {
      embedding[i % 384] += text.charCodeAt(i);
    }
    return embedding.map(x => x / (text.length || 1));
  }
  
  private magnitudeRatio(curr: number[], prev: number[]): number {
    const magCurr = Math.sqrt(curr.reduce((s, x) => s + x * x, 0));
    const magPrev = Math.sqrt(prev.reduce((s, x) => s + x * x, 0));
    return magPrev > 0 ? magCurr / magPrev : 1;
  }
  
  private cosineSimilarity(a: number[], b: number[]): number {
    const dot = a.reduce((s, x, i) => s + x * (b[i] || 0), 0);
    const magA = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    const magB = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
    return dot / ((magA * magB) || 1);
  }
}

export class TokenRetention {
  private gamma: number = 0.05;
  
  setGamma(g: number): void {
    this.gamma = g;
  }
  
  /**
   * Token Retention Threshold:
   * I = {i | d_i < d_min + (d_max - d_min) * γ}
   * where d_i = (1/π) * arccos(cos_sim_i) is angular distance
   */
  computeRetentionMask(
    currentLayer: number[][],
    previousLayer: number[]
  ): boolean[] {
    const mask: boolean[] = [];
    
    // Compute angular distances
    const distances: number[] = [];
    let dMin = Infinity;
    let dMax = -Infinity;
    
    for (let i = 0; i < currentLayer.length; i++) {
      const cosSim = this.cosineSimilarity(
        currentLayer[i],
        previousLayer[i] || currentLayer[i]
      );
      
      // Angular distance: d_i = (1/π) * arccos(cos_sim)
      const d = (1 / Math.PI) * Math.acos(Math.max(-1, Math.min(1, cosSim)));
      
      distances.push(d);
      dMin = Math.min(dMin, d);
      dMax = Math.max(dMax, d);
    }
    
    // Compute threshold
    const threshold = dMin + (dMax - dMin) * this.gamma;
    
    // Create mask
    for (const d of distances) {
      mask.push(d < threshold);  // Retain if distance < threshold
    }
    
    return mask;
  }
  
  /**
   * Get retained tokens
   */
  getRetained(
    layer: number[][],
    mask: boolean[]
  ): number[][] {
    return layer.filter((_, i) => mask[i]);
  }
  
  /**
   * Get removed tokens
   */
  getRemoved(
    layer: number[][],
    mask: boolean[]
  ): number[][] {
    return layer.filter((_, i) => !mask[i]);
  }
  
  /**
   * Estimate retention ratio
   */
  getRetentionRatio(mask: boolean[]): number {
    const retained = mask.filter(x => x).length;
    return retained / (mask.length || 1);
  }
  
  private cosineSimilarity(a: number[], b: number[]): number {
    const dot = a.reduce((s, x, i) => s + x * (b[i] || 0), 0);
    const magA = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    const magB = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
    return dot / ((magA * magB) || 1);
  }
}

export class MetaLearner {
  private interpolator: AdaptiveInterpolator;
  private retention: TokenRetention;
  
  constructor() {
    this.interpolator = new AdaptiveInterpolator();
    this.retention = new TokenRetention();
  }
  
  /**
   * Predict compression decision
   */
  predict(
    attentionMatrix: number[][],
    taskQuery: string,
    layerIndex: number,
    totalLayers: number,
    currentLayer: number[],
    previousLayer: number[]
  ): {
    shouldMerge: boolean;
    t: number;
    gamma: number;
  } {
    // Extract features
    const features = this.interpolator.extractFeatures(
      attentionMatrix,
      taskQuery,
      layerIndex,
      totalLayers,
      currentLayer,
      previousLayer
    );
    
    // Compute t (interpolation parameter)
    const t = this.interpolator.computeT(features);
    
    // Decide whether to merge
    const shouldMerge = features.entropy > 0.5 || t > 0.4;
    
    // Gamma from layer depth (deeper = more aggressive)
    const gamma = 0.03 + features.layerDepth * 0.04;
    this.retention.setGamma(gamma);
    
    return {
      shouldMerge,
      t,
      gamma
    };
  }
  
  /**
   * Apply compression and get result
   */
  compress(
    currentLayer: number[][],
    previousLayer: number[][],
    taskQuery: string,
    layerIndex: number,
    totalLayers: number,
    attentionMatrix: number[][]
  ): {
    merged: number[][];
    retained: number[][];
    removed: number[][];
    mask: boolean[];
  } {
    // Get decision
    const decision = this.predict(
      attentionMatrix,
      taskQuery,
      layerIndex,
      totalLayers,
      currentLayer.flat(),
      previousLayer.flat()
    );
    
    if (!decision.shouldMerge) {
      return {
        merged: currentLayer,
        retained: [],
        removed: [],
        mask: []
      };
    }
    
    // Get retention mask
    const mask = this.retention.computeRetentionMask(
      currentLayer,
      previousLayer
    );
    
    // Get retained and removed
    const retained = this.retention.getRetained(currentLayer, mask);
    const removed = this.retention.getRemoved(currentLayer, mask);
    
    // Simple merge (in production use SLERP)
    const merged = currentLayer.map((row, i) => 
      row.map((v, j) => 
        v * decision.t + (previousLayer[i]?.[j] || 0) * (1 - decision.t)
      )
    );
    
    return {
      merged,
      retained,
      removed,
      mask
    };
  }
  
  /**
   * Update from feedback (simple learning)
   */
  update(
    features: CompressionFeatures,
    actualQuality: number,
    expectedQuality: number
  ): void {
    // Compute target t based on quality
    const qualityDelta = expectedQuality - actualQuality;
    const targetT = qualityDelta > 0 ? 0.6 : 0.4;
    
    // Update interpolator
    this.interpolator.update(features, targetT);
  }
}

export const createMetaLearner = () => new MetaLearner();
export const createAdaptiveInterpolator = () => new AdaptiveInterpolator();
export const createTokenRetention = () => new TokenRetention();
