/**
 * Main Nexus Prime Class
 * 
 * The self-evolving agent operating system.
 */

import { v4 as uuidv4 } from 'uuid';
import { Agent, AgentType, NexusConfig, Experience, Pattern, NetworkMessage } from './core/types.js';
import { MemorySystem, createMemory } from './core/memory.js';
import { EvolutionEngine, FissionProtocol, createEvolutionEngine, createFissionProtocol } from './core/evolution.js';
import { AttentionEconomics, TokenOptimizer, InfiniteContext, createAttentionEconomics, createTokenOptimizer, createInfiniteContext } from './core/optimize.js';
import { AgentCoordinator, createCoordinator, Topology, Consensus } from './agents/coordinator.js';
import { Adapter, createAdapter, AdapterType } from './agents/adapters.js';

export class NexusPrime {
  private config: NexusConfig;
  private adapters: Map<string, Adapter> = new Map();
  private agents: Map<string, Agent> = new Map();
  private memories: Map<string, MemorySystem> = new Map();
  private coordinator: AgentCoordinator;
  private evolution: EvolutionEngine;
  private fission: FissionProtocol;
  private attention: AttentionEconomics;
  private tokens: TokenOptimizer;
  private context: InfiniteContext;
  private running = false;

  constructor(config?: Partial<NexusConfig>) {
    this.config = {
      network: {
        port: config?.network?.port ?? 3000,
        peers: config?.network?.peers ?? [],
        consensus: config?.network?.consensus ?? 'raft'
      },
      memory: {
        cortex: {
          enabled: config?.memory?.cortex?.enabled ?? true,
          storage: config?.memory?.cortex?.storage ?? 'sqlite',
          vector: config?.memory?.cortex?.vector ?? 'hnsw'
        },
        hippocampus: {
          window: config?.memory?.hippocampus?.window ?? '48h',
          consolidation: config?.memory?.hippocampus?.consolidation ?? '6h'
        },
        prefrontal: {
          items: config?.memory?.prefrontal?.items ?? 7
        }
      },
      evolution: {
        mutationRate: config?.evolution?.mutationRate ?? 0.01,
        selectionPressure: config?.evolution?.selectionPressure ?? 0.9,
        coherenceThreshold: config?.evolution?.coherenceThreshold ?? 0.8
      },
      adapters: config?.adapters ?? []
    };

    // Initialize systems
    this.coordinator = createCoordinator('hierarchical', this.config.network.consensus);
    this.evolution = createEvolutionEngine(this.config.evolution);
    this.fission = createFissionProtocol();
    this.attention = createAttentionEconomics();
    this.tokens = createTokenOptimizer();
    this.context = createInfiniteContext();
  }

  // ==================== LIFECYCLE ====================

  async start(): Promise<void> {
    console.log('🧬 Nexus Prime starting...');
    
    // Connect adapters
    for (const adapterType of this.config.adapters) {
      await this.addAdapter(adapterType as AdapterType);
    }

    this.running = true;
    console.log('✅ Nexus Prime running');
  }

  async stop(): Promise<void> {
    console.log('🧬 Nexus Prime stopping...');
    
    // Disconnect adapters
    for (const [, adapter] of this.adapters) {
      await adapter.disconnect();
    }

    this.running = false;
    console.log('✅ Nexus Prime stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  // ==================== ADAPTERS ====================

  async addAdapter(type: AdapterType, customName?: string): Promise<void> {
    const adapter = createAdapter(type, customName);
    await adapter.connect();
    this.adapters.set(adapter.name, adapter);
    console.log(`📦 Added adapter: ${adapter.name}`);
  }

  removeAdapter(name: string): void {
    const adapter = this.adapters.get(name);
    if (adapter) {
      adapter.disconnect();
      this.adapters.delete(name);
    }
  }

  getAdapter(name: string): Adapter | undefined {
    return this.adapters.get(name);
  }

  getAdapters(): Adapter[] {
    return Array.from(this.adapters.values());
  }

  // ==================== AGENTS ====================

  async createAgent(
    type: AgentType,
    options?: {
      id?: string;
      capabilities?: string[];
      memory?: boolean;
    }
  ): Promise<Agent> {
    const id = options?.id ?? `agent_${type}_${uuidv4()}`;

    const agent: Agent = {
      id,
      type,
      capabilities: options?.capabilities ?? this.getDefaultCapabilities(type),
      memory: null as unknown as any, // Set below
      attention: 0.1,
      state: {
        current: 'idle',
        history: []
      }
    };

    // Create memory for agent
    const memory = createMemory({
      hippocampusWindowHours: 48,
      prefrontalMaxItems: 7
    });
    this.memories.set(id, memory);
    (agent as any).memory = memory;

    // Register with coordinator
    this.coordinator.register(agent);
    this.agents.set(id, agent);

    console.log(`🤖 Created agent: ${id} (${type})`);

    return agent;
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  getAgentsByType(type: AgentType): Agent[] {
    return Array.from(this.agents.values()).filter(a => a.type === type);
  }

  // ==================== EXECUTION ====================

  async execute(
    agentId: string,
    task: string
  ): Promise<{ result: string; experience: Experience }> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Update state
    agent.state.current = 'working';
    agent.state.history.push(task);

    // Optimize tokens
    const memory = this.memories.get(agentId);
    const working = memory?.getWorking() ?? [];
    const tokenPlan = this.tokens.optimize(task, working);

    // Simulate execution
    const result = `Executed: ${task}`;

    // Calculate value (simplified)
    const value = Math.random();

    // Create experience
    const experience: Experience = {
      agentId,
      action: task,
      outcome: result,
      value,
      timestamp: Date.now()
    };

    // Learn
    if (memory) {
      memory.learn(experience);
    }

    // Update attention
    this.attention.recordPerformance(agentId, value);

    // Check for fission
    if (value > 0.9) {
      const pattern = memory?.learn(experience);
      if (pattern) {
        const neighbors = this.coordinator.getNeighbors(agentId);
        this.fission.fission(pattern, neighbors, (id) => ({
          receive: (p: Pattern, v: number) => {
            const mem = this.memories.get(id);
            if (mem) {
              mem.learn({
                agentId: id,
                action: 'fission_received',
                outcome: p.id,
                value: v,
                timestamp: Date.now()
              });
            }
          }
        }));
      }
    }

    // Update state
    agent.state.current = 'idle';

    // Add to working memory
    memory?.addToWorking(task);

    return { result, experience };
  }

  // ==================== COORDINATION ====================

  async coordinate(
    task: string,
    agentIds?: string[]
  ): Promise<Array<{ agentId: string; result: unknown }>> {
    const agents = agentIds ?? Array.from(this.agents.keys());
    return this.coordinator.coordinate(task, agents);
  }

  async achieveConsensus(
    proposal: string,
    agentIds?: string[]
  ): Promise<{ decided: boolean; result?: string }> {
    const agents = agentIds ?? Array.from(this.agents.keys());
    return this.coordinator.consensusDecide(proposal, agents);
  }

  // ==================== MEMORY ====================

  recall(agentId: string, query: number[], k: number = 5): Array<{ pattern: Pattern; score: number }> {
    const memory = this.memories.get(agentId);
    if (!memory) return [];
    return memory.recall(query, k);
  }

  searchMemory(query: string, k: number = 10): string[] {
    return this.context.think(query, k);
  }

  // ==================== EVOLUTION ====================

  evolve(): void {
    const health = {
      coherence: 0.8, // Simplified
      stagnation: 0.2
    };
    this.evolution.govern(health);
  }

  getGrammar() {
    return this.evolution.getGrammar();
  }

  // ==================== NETWORK ====================

  async broadcast(message: Omit<NetworkMessage, 'id' | 'timestamp'>): Promise<void> {
    const fullMessage: NetworkMessage = {
      ...message,
      id: uuidv4(),
      timestamp: Date.now()
    };

    for (const [, adapter] of this.adapters) {
      if (adapter.connected) {
        await adapter.send(fullMessage);
      }
    }
  }

  // ==================== HELPERS ====================

  private getDefaultCapabilities(type: AgentType): string[] {
    const capabilities: Record<AgentType, string[]> = {
      researcher: ['search', 'read', 'summarize', 'hypothesize'],
      coder: ['write', 'edit', 'refactor', 'debug'],
      reviewer: ['analyze', 'critique', 'suggest', 'approve'],
      tester: ['test', 'validate', 'verify', 'benchmark'],
      architect: ['design', 'plan', 'evaluate', 'optimize'],
      planner: ['plan', 'schedule', 'coordinate', 'prioritize'],
      executor: ['run', 'execute', 'deploy', 'monitor'],
      general: ['reason', 'learn', 'communicate', 'adapt']
    };
    return capabilities[type] ?? capabilities.general;
  }

  // ==================== STATE ====================

  getConfig(): NexusConfig {
    return { ...this.config };
  }

  getStats(): {
    agents: number;
    adapters: number;
    grammarRules: number;
    running: boolean;
  } {
    return {
      agents: this.agents.size,
      adapters: this.adapters.size,
      grammarRules: this.evolution.getGrammar().length,
      running: this.running
    };
  }
}

// ==================== FACTORY ====================

export const createNexusPrime = (config?: Partial<NexusConfig>) => 
  new NexusPrime(config);
