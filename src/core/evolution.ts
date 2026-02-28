/**
 * Evolution Engine
 * 
 * Meta-evolution layer that controls language evolution itself.
 * Includes emergent grammar and fission protocol.
 */

import { GrammarRule, EvolutionPolicy, Pattern, NetworkMessage } from './types.js';

export class EvolutionEngine {
  private grammar: Map<string, GrammarRule> = new Map();
  private policy: EvolutionPolicy;
  private mutationHistory: Array<{ mutation: unknown; success: boolean }> = [];
  private sandboxResults: Map<string, boolean> = new Map();

  constructor(policy?: Partial<EvolutionPolicy>) {
    this.policy = {
      mutationRate: policy?.mutationRate ?? 0.01,
      selectionPressure: policy?.selectionPressure ?? 0.9,
      coherenceThreshold: policy?.coherenceThreshold ?? 0.8,
      diversityWeight: policy?.diversityWeight ?? 0.3
    };
  }

  // ==================== GRAMMAR MANAGEMENT ====================

  /**
   * Get current grammar rules
   */
  getGrammar(): GrammarRule[] {
    return Array.from(this.grammar.values());
  }

  /**
   * Add a grammar rule
   */
  addRule(rule: GrammarRule): void {
    this.grammar.set(rule.id, rule);
  }

  /**
   * Find matching grammar rule for a pattern
   */
  matchRule(pattern: string[]): GrammarRule | null {
    let bestMatch: GrammarRule | null = null;
    let bestScore = 0;

    for (const rule of this.grammar.values()) {
      const score = this.calculateMatchScore(pattern, rule.pattern);
      if (score > bestScore && score > 0.7) {
        bestScore = score;
        bestMatch = rule;
      }
    }

    return bestMatch;
  }

  /**
   * Calculate how well a pattern matches a rule
   */
  private calculateMatchScore(pattern: string[], rule: string[]): number {
    if (rule.length === 0) return 0;

    let matches = 0;
    for (const token of pattern) {
      if (rule.includes(token)) {
        matches++;
      }
    }

    return matches / Math.max(pattern.length, rule.length);
  }

  // ==================== MUTATION ====================

  /**
   * Generate a grammar mutation
   */
  generateMutation(): GrammarRule {
    const types = ['add_token', 'remove_token', 'combine_rules', 'split_rule'];
    const type = types[Math.floor(Math.random() * types.length)];

    const mutation: GrammarRule = {
      id: `mutation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      pattern: this.generatePattern(type),
      weight: 0.1, // Start low
      adoptionRate: 0,
      confidence: 0.1
    };

    return mutation;
  }

  /**
   * Generate a pattern based on mutation type
   */
  private generatePattern(type: string): string[] {
    const tokens = ['search', 'read', 'write', 'analyze', 'execute', 'learn', 
                   'review', 'test', 'plan', 'create', 'debug', 'optimize'];
    
    switch (type) {
      case 'add_token':
        return [tokens[Math.floor(Math.random() * tokens.length)]];
      case 'remove_token':
        return [];
      case 'combine_rules':
        return [
          tokens[Math.floor(Math.random() * tokens.length)],
          tokens[Math.floor(Math.random() * tokens.length)]
        ];
      case 'split_rule':
      default:
        return [tokens[Math.floor(Math.random() * tokens.length)]];
    }
  }

  /**
   * Test mutation in sandbox
   */
  async testMutation(mutation: GrammarRule): Promise<boolean> {
    // Simulate sandbox test
    // In production, this would actually run the mutation
    const success = Math.random() > 0.5;
    this.sandboxResults.set(mutation.id, success);
    return success;
  }

  /**
   * Incorporate successful mutation
   */
  incorporate(mutation: GrammarRule): void {
    // Add or update rule
    const existing = this.grammar.get(mutation.id);
    if (existing) {
      existing.weight = Math.min(1, existing.weight + 0.1);
      existing.confidence = Math.min(1, existing.confidence + 0.1);
    } else {
      this.grammar.set(mutation.id, mutation);
    }
  }

  /**
   * Check adoption rate
   */
  getAdoptionRate(mutationId: string): number {
    const rule = this.grammar.get(mutationId);
    return rule?.adoptionRate ?? 0;
  }

  /**
   * Update adoption rate
   */
  updateAdoptionRate(mutationId: string, rate: number): void {
    const rule = this.grammar.get(mutationId);
    if (rule) {
      rule.adoptionRate = rate;
    }
  }

  // ==================== META-EVOLUTION ====================

  /**
   * Govern the evolution process
   */
  govern(health: { coherence: number; stagnation: number }): void {
    // Check if grammar needs mutation
    if (health.coherence < this.policy.coherenceThreshold) {
      this.mutateGrammar();
    }

    // Check if diversity is needed
    if (health.stagnation > 0.8) {
      this.introduceDiversity();
    }

    // Evolve the policy itself
    this.metaLearn();
  }

  /**
   * Mutate the grammar
   */
  mutateGrammar(): void {
    const mutation = this.generateMutation();
    
    // Test in sandbox
    this.testMutation(mutation).then(success => {
      if (success) {
        this.incorporate(mutation);
      }
    });
  }

  /**
   * Introduce diversity
   */
  introduceDiversity(): void {
    // Generate new random rules
    for (let i = 0; i < 5; i++) {
      const rule: GrammarRule = {
        id: `diversity_${Date.now()}_${i}`,
        pattern: this.generatePattern('add_token'),
        weight: 0.1 * this.policy.diversityWeight,
        adoptionRate: 0,
        confidence: 0.1
      };
      this.grammar.set(rule.id, rule);
    }
  }

  /**
   * Learn from mutation history
   */
  metaLearn(): void {
    const successes = this.mutationHistory.filter(m => m.success).length;
    const failures = this.mutationHistory.filter(m => !m.success).length;
    const total = successes + failures;

    if (total === 0) return;

    // Adjust mutation rate based on success rate
    if (successes > failures) {
      this.policy.mutationRate = Math.min(0.1, this.policy.mutationRate * 1.01);
    } else {
      this.policy.mutationRate = Math.max(0.001, this.policy.mutationRate * 0.9);
      this.policy.selectionPressure = Math.min(0.99, this.policy.selectionPressure * 1.1);
    }

    // Keep history bounded
    if (this.mutationHistory.length > 1000) {
      this.mutationHistory = this.mutationHistory.slice(-500);
    }
  }

  /**
   * Record mutation result
   */
  recordMutation(mutation: unknown, success: boolean): void {
    this.mutationHistory.push({ mutation, success });
  }

  // ==================== GRAMMAR STABILIZATION ====================

  /**
   * Stabilize grammar: convert high-adoption patterns to rules
   */
  stabilizeGrammar(): GrammarRule[] {
    const stable: GrammarRule[] = [];

    for (const rule of this.grammar.values()) {
      if (rule.adoptionRate > this.policy.selectionPressure) {
        rule.confidence = 1;
        stable.push(rule);
      }
    }

    return stable;
  }

  /**
   * Prune low-confidence rules
   */
  pruneGrammar(): void {
    for (const [id, rule] of this.grammar) {
      if (rule.confidence < 0.1) {
        this.grammar.delete(id);
      }
    }
  }

  // ==================== PATTERN DISCOVERY ====================

  /**
   * Discover new patterns from agent interactions
   */
  discoverPattern(interaction: {
    tokens: string[];
    success: boolean;
    value: number;
  }): GrammarRule | null {
    if (!interaction.success || interaction.value < 0.5) {
      return null;
    }

    // Check if pattern already exists
    const existing = this.matchRule(interaction.tokens);
    if (existing) {
      existing.weight = Math.min(1, existing.weight + interaction.value * 0.1);
      existing.confidence = Math.min(1, existing.confidence + 0.05);
      return existing;
    }

    // Create new rule
    const newRule: GrammarRule = {
      id: `discovered_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      pattern: interaction.tokens,
      weight: interaction.value,
      adoptionRate: 0.1,
      confidence: interaction.value
    };

    this.grammar.set(newRule.id, newRule);
    return newRule;
  }

  // ==================== STATE ====================

  getPolicy(): EvolutionPolicy {
    return { ...this.policy };
  }

  setPolicy(policy: Partial<EvolutionPolicy>): void {
    Object.assign(this.policy, policy);
  }
}

// ==================== FISSION PROTOCOL ====================

export class FissionProtocol {
  private propagationThreshold = 0.9;
  private decayRate = 0.1;
  private branchingFactor = 3;
  private propagationQueue: Array<{ pattern: Pattern; value: number }> = [];

  /**
   * Trigger fission when pattern value exceeds threshold
   */
  fission(pattern: Pattern, neighbors: string[], getNeighbor: (id: string) => {
    receive: (pattern: Pattern, value: number) => void;
  }): void {
    if (pattern.weight < this.propagationThreshold) {
      return;
    }

    // Broadcast to nearest neighbors
    for (const neighborId of neighbors.slice(0, this.branchingFactor)) {
      const neighbor = getNeighbor(neighborId);
      if (neighbor) {
        neighbor.receive(pattern, pattern.weight);
      }
    }
  }

  /**
   * Receive pattern from fission
   */
  receive(pattern: Pattern, value: number): Pattern {
    // Apply decay
    const decayedValue = value * (1 - this.decayRate);

    // Return modified pattern
    return {
      ...pattern,
      weight: decayedValue,
      confidence: pattern.confidence * 0.9
    };
  }

  /**
   * Set propagation threshold
   */
  setThreshold(threshold: number): void {
    this.propagationThreshold = threshold;
  }

  /**
   * Set branching factor
   */
  setBranchingFactor(factor: number): void {
    this.branchingFactor = factor;
  }
}

// ==================== FACTORY ====================

export const createEvolutionEngine = (policy?: Partial<EvolutionPolicy>) => 
  new EvolutionEngine(policy);

export const createFissionProtocol = () => new FissionProtocol();
