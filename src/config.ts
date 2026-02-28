/**
 * Default configuration for Nexus Prime
 */

export const defaultConfig = {
  network: {
    port: 3000,
    peers: [],
    consensus: 'raft' as const
  },
  
  memory: {
    cortex: {
      enabled: true,
      storage: 'sqlite' as const,
      vector: 'hnsw' as const
    },
    hippocampus: {
      window: '48h',
      consolidation: '6h'
    },
    prefrontal: {
      items: 7
    }
  },
  
  evolution: {
    mutationRate: 0.01,
    selectionPressure: 0.9,
    coherenceThreshold: 0.8
  },
  
  adapters: ['openclaw']
};

export const environments = {
  development: {
    network: {
      port: 3000,
      peers: [],
      consensus: 'raft' as const
    }
  },
  
  production: {
    network: {
      port: 8080,
      peers: [],
      consensus: 'bft' as const
    },
    evolution: {
      mutationRate: 0.005,
      selectionPressure: 0.95,
      coherenceThreshold: 0.9
    }
  },
  
  test: {
    network: {
      port: 3001,
      peers: [],
      consensus: 'raft' as const
    },
    memory: {
      cortex: {
        enabled: true,
        storage: 'sqlite' as const,
        vector: 'flat' as const
      },
      hippocampus: {
        window: '1h',
        consolidation: '15m'
      },
      prefrontal: {
        items: 3
      }
    }
  }
};

export type Environment = keyof typeof environments;
