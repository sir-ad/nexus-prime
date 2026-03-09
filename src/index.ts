/**
 * Nexus Prime - Enhanced with Engines
 * 
 * The Self-Evolving Agent Operating System
 */

import { v4 as uuidv4 } from 'uuid';
import { NexusConfig, Experience, Pattern, NetworkMessage, Agent, AgentType } from './core/types.js';
import { MemorySystem, createMemory } from './core/memory.js';
import { EvolutionEngine, FissionProtocol, createEvolutionEngine, createFissionProtocol } from './core/evolution.js';
import { AttentionEconomics, TokenOptimizer, InfiniteContext, createAttentionEconomics, createInfiniteContext } from './core/optimize.js';
import { AgentCoordinator, createCoordinator, Topology, Consensus } from './agents/coordinator.js';
import { Adapter, createAdapter, AdapterType } from './agents/adapters.js';
import { AgentLearner } from './agents/learner.js';

// Import engines
import {
  createTokenOptimizer,
  createContextEngine,
  createMemoryEngine,
  createOrchestrator
} from './engines/index.js';
import { DashboardServer } from './dashboard/server.js';
import { nexusEventBus } from './engines/event-bus.js';
import {
  createSubAgentRuntime,
  summarizeExecution,
  type ExecutionRun,
  type ExecutionTask,
  type SubAgentRuntime
} from './phantom/index.js';

export class NexusPrime {
  private config: NexusConfig;
  private adapters: Map<string, Adapter> = new Map();
  private agents: Map<string, Agent> = new Map();
  private memories: Map<string, MemorySystem> = new Map();

  // NEW: Enhanced Engines
  private tokenOptimizer: any;
  private contextEngine: any;
  private memoryEngine: any;
  private orchestrator: any;
  private runtime: SubAgentRuntime;
  private learner: AgentLearner;

  private coordinator: AgentCoordinator;
  private evolution: EvolutionEngine;
  private fission: FissionProtocol;
  private attention: AttentionEconomics;
  private context: InfiniteContext;
  private running = false;
  private dashboardServer: DashboardServer;

  constructor(config?: Partial<NexusConfig>) {
    const memoryDbPath = config?.memory?.cortex?.path ?? process.env.NEXUS_MEMORY_DB_PATH;
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
          vector: config?.memory?.cortex?.vector ?? 'hnsw',
          path: memoryDbPath
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

    // Initialize legacy systems
    this.coordinator = createCoordinator('hierarchical', this.config.network.consensus);
    this.evolution = createEvolutionEngine(this.config.evolution);
    this.fission = createFissionProtocol();
    this.attention = createAttentionEconomics();
    this.context = createInfiniteContext();

    // Initialize NEW engines
    this.tokenOptimizer = createTokenOptimizer(this.config.memory.cortex.enabled ? 128000 : 64000);
    this.contextEngine = createContextEngine();
    this.memoryEngine = createMemoryEngine(memoryDbPath);
    this.runtime = createSubAgentRuntime({
      repoRoot: process.cwd(),
      memory: this.memoryEngine,
    });
    this.orchestrator = createOrchestrator(this.memoryEngine, this.runtime);
    this.learner = new AgentLearner(this.memoryEngine);
    this.dashboardServer = new DashboardServer();
  }

  async start(): Promise<void> {
    console.error('🧬 Nexus Prime (Enhanced) starting...');

    for (const adapterType of this.config.adapters) {
      await this.addAdapter(adapterType as AdapterType);
    }

    this.dashboardServer.start();
    nexusEventBus.emit('system.boot', { version: '2.0.0', toolsCount: 11 });

    this.running = true;
    console.error('✅ Nexus Prime running with engines!');
  }

  async stop(): Promise<void> {
    console.error('🧬 Nexus Prime stopping...');

    for (const [, adapter] of this.adapters) {
      await adapter.disconnect();
    }

    this.dashboardServer.stop();

    this.running = false;
    console.error('✅ Nexus Prime stopped');
  }

  /** Flush memory engine to SQLite (call before process exit) */
  flushMemory(): void {
    if (this.memoryEngine && typeof this.memoryEngine.flush === 'function') {
      this.memoryEngine.flush();
    }
  }

  /** Load memory from SQLite (call on startup) */
  loadMemory(): void {
    if (this.memoryEngine && typeof this.memoryEngine.load === 'function') {
      this.memoryEngine.load();
    }
  }

  /** Get the memory engine instance */
  get memory(): any {
    return this.memoryEngine;
  }

  /** Get memory tier stats (used by nexus_memory_stats MCP tool) */
  getMemoryStats(): {
    prefrontal: number;
    hippocampus: number;
    cortex: number;
    totalLinks: number;
    oldestEntry: number | null;
    topTags: string[];
  } {
    if (this.memoryEngine && typeof this.memoryEngine.getStats === 'function') {
      return this.memoryEngine.getStats();
    }
    return { prefrontal: 0, hippocampus: 0, cortex: 0, totalLinks: 0, oldestEntry: null, topTags: [] };
  }



  async addAdapter(type: AdapterType, customName?: string): Promise<void> {
    const adapter = createAdapter(type, customName);
    if (adapter.type === 'mcp') {
      (adapter as any).setNexusRef(this);
    }
    await adapter.connect();
    this.adapters.set(adapter.name, adapter);
  }

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
      memory: null as any,
      attention: 0.1,
      state: {
        current: 'idle',
        history: []
      }
    };

    const memory = createMemory({
      hippocampusWindowHours: 48,
      prefrontalMaxItems: 7
    });
    this.memories.set(id, memory);
    (agent as any).memory = memory;

    this.coordinator.register(agent);
    this.agents.set(id, agent);

    console.error(`🤖 Created agent: ${id} (${type})`);

    return agent;
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  getAdapters(): Adapter[] {
    return Array.from(this.adapters.values());
  }

  // ===== NEW ENGINE METHODS =====

  /**
   * Optimize tokens using TokenOptimizer
   */
  optimizeTokens(task: string): any {
    const context = this.contextEngine.getAll();
    return this.tokenOptimizer.optimize(Array.isArray(context) ? context : [context], task);
  }

  /**
   * Add to context
   */
  addContext(content: string): void {
    this.contextEngine.add(content);
  }

  /**
   * Get relevant context
   */
  getContext(query: string): string[] {
    return this.contextEngine.getContext(query);
  }

  /**
   * Store in memory
   */
  storeMemory(content: string, priority: number = 1.0, tags: string[] = [], parentId?: string, depth?: number): string {
    return this.memoryEngine.store(content, priority, tags, parentId, depth);
  }

  /**
   * Recall from memory
   */
  async recallMemory(query: string, k: number = 5): Promise<string[]> {
    return this.memoryEngine.recall(query, k);
  }

  /**
   * Audit evolution candidates — returns structured analysis.
   */
  async auditEvolution() {
    return this.learner.identifyEvolutionCandidates();
  }

  /**
   * Analyze result for learning
   */
  async analyzeLearning(goal: string, decision: any): Promise<void> {
    await this.learner.analyze(goal, decision);
  }

  /**
   * Execute via orchestrator
   */
  async orchestrate(task: string, options?: Partial<ExecutionTask>): Promise<ExecutionRun> {
    return this.orchestrator.executeSwarm(task, options);
  }


  // ===== EXECUTE (Enhanced) =====

  async execute(
    agentId: string,
    task: string,
    options?: Partial<ExecutionTask>
  ): Promise<{ result: string; experience: Experience; execution: ExecutionRun }> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Use NEW engines
    const tokenPlan = this.optimizeTokens(task);
    const context = this.getContext(task);

    agent.state.current = 'working';
    agent.state.history.push(task);

    const execution = await this.runtime.run({
      goal: task,
      ...options,
    });
    const result = execution.result || summarizeExecution(execution);
    const value = execution.state === 'merged'
      ? 1
      : execution.state === 'rolled_back'
        ? 0.25
        : execution.state === 'failed'
          ? 0.1
          : 0.6;

    const experience: Experience = {
      agentId,
      action: task,
      outcome: result,
      value,
      timestamp: Date.now()
    };

    // Learn (using legacy system)
    const memory = this.memories.get(agentId);
    if (memory) {
      memory.learn(experience);
    }

    // Also store in new memory engine
    this.storeMemory(
      `Agent ${agentId} executed: ${task} → ${result}`,
      value,
      [agent.type, 'execution', execution.state]
    );

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

    agent.state.current = 'idle';

    return { result, experience, execution };
  }

  getRuntime(): SubAgentRuntime {
    return this.runtime;
  }

  evolve(): void {
    const health = { coherence: 0.8, stagnation: 0.2 };
    this.evolution.govern(health);
  }

  getGrammar() {
    return this.evolution.getGrammar();
  }

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

  getConfig(): NexusConfig {
    return { ...this.config };
  }

  getStats(): any {
    return {
      agents: this.agents.size,
      adapters: this.adapters.size,
      grammarRules: this.evolution.getGrammar().length,
      running: this.running,
      memory: this.getMemoryStats(),
      tokens: this.optimizeTokens('status check')
    };
  }

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
}

export const createNexusPrime = (config?: Partial<NexusConfig>) =>
  new NexusPrime(config);
