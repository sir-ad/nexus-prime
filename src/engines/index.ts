/**
 * Nexus Prime Engines
 * 
 * All core engines for the Nexus Prime system.
 */

export { TokenSupremacyEngine as TokenOptimizer, createTokenSupremacyEngine as createTokenOptimizer } from './token-supremacy.js';
export { SLERPCompressor, createSLERPCompressor } from './token-optimizer.js';
export { ContextEngine, createContextEngine } from './context.js';

export { MemoryEngine, createMemoryEngine } from './memory.js';
export type { MemoryItem } from './memory.js';

export { OrchestratorEngine, createOrchestrator } from './orchestrator.js';
export type { Agent, AgentType, Task } from './orchestrator.js';

export { CacheManager, createCacheManager } from './cache-manager.js';
export type { CacheEntry, AgentDelta } from './cache-manager.js';

export {
  MetaLearner,
  AdaptiveInterpolator,
  TokenRetention,
  createMetaLearner,
  createAdaptiveInterpolator,
  createTokenRetention
} from './meta-learner.js';
export type { CompressionFeatures } from './meta-learner.js';

export {
  BenchmarkSuite,
  createBenchmarkSuite,
  EXPECTED_RESULTS
} from './benchmark.js';
export type { BenchmarkResult } from './benchmark.js';
