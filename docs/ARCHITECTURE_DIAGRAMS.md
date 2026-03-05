# Nexus Prime — Architecture Diagrams (Draft)

## 1. System Architecture (Phase 9 - Quantum/CAS Integrated)

```mermaid
flowchart TB
    User["Agent (AntiGravity)"]:::client
    
    subgraph Nexus["Nexus Prime runtime"]
        MCP["MCP Adapter"]:::adapter
        
        subgraph Core["Core Engines"]
            direction TB
            Memory["Memory Engine<br/>(3-tier)"]:::engine
            Tokens["Token Supremacy<br/>(HyperTune)"]:::engine
            Guard["MindKit Bridge<br/>(Machine Checked)"]:::engine
        end
        
        subgraph Phase9["Innovation Layer"]
            direction RL
            Entangle["Entanglement Engine<br/>(Agent Telepathy)"]:::innovation
            CAS["CAS Engine<br/>(Continuous Attention)"]:::innovation
            KV["KV-Bridge<br/>(Aggressive Compression)"]:::innovation
        end
    end
    
    subgraph Swarm["Phantom Swarm"]
        GP["Ghost Pass"]:::swarm
        PW["Workers (Worktrees)"]:::swarm
        OR["Merge Oracle"]:::swarm
    end
    
    User <--> MCP
    MCP <--> Core
    Core <--> Phase9
    MCP <--> Swarm
    
    classDef client fill:#000,stroke:#00ff88,color:#00ff88
    classDef adapter fill:#1a1a1a,stroke:#00d4ff,color:#00d4ff
    classDef engine fill:#1a1a1a,stroke:#8b5cf6,color:#8b5cf6
    classDef innovation fill:#2e1065,stroke:#d946ef,color:#d946ef
    classDef swarm fill:#450a0a,stroke:#ef4444,color:#ef4444
```

## 2. Memory Tier Visualization

```mermaid
graph TD
    Input["New Fact/Insight"] --> P
    
    subgraph Memory["Tiered Architecture"]
        P["Prefrontal (RAM)<br/>Top 7 - Active Context"]:::tier1
        H["Hippocampus (RAM)<br/>Recent 200 - Session Memory"]:::tier2
        C["Cortex (SQLite)<br/>Unlimited - Long-term Knowledge"]:::tier3
    end
    
    P <-->|"Promote/Demote"| H
    H <-->|"Flush/Fetch"| C
    
    classDef tier1 fill:#064e3b,stroke:#059669,color:#fff
    classDef tier2 fill:#14532d,stroke:#16a34a,color:#fff
    classDef tier3 fill:#0f172a,stroke:#3b82f6,color:#fff
```

## 3. Token Optimization Flow

```mermaid
sequenceDiagram
    participant A as Agent
    participant T as Token Supremacy
    participant F as Filesystem
    
    A->>T: nexus_optimize_tokens(task, files)
    T->>F: Read AST/Metadata
    F-->>T: Structure returned
    T->>T: Score Relevance (TF-IDF)
    T->>T: Check Budget (HyperTune)
    T-->>A: Reading Plan (READ | OUTLINE | SKIP)
```

## 4. Agent Self-Awareness Loop

```mermaid
flowchart LR
    A["Recall Memory"] --> B["Plan Task"]
    B --> C["Verify Guardrails"]
    C --> D["Execute / Solve"]
    D --> E["Store Insight"]
    E --> A
    
    style A stroke:#00ff88,stroke-width:2px
    style E stroke:#00ff88,stroke-width:2px
```

## 5. Phantom Worker Swarm

```mermaid
stateDiagram-v2
    [*] --> GhostPass: Task Triggered
    GhostPass --> WorkerSpawn: Analysis Complete
    state WorkerSpawn {
        Worker_A: approach=safe
        Worker_B: approach=aggressive
    }
    Worker_A --> POD: Learnings
    Worker_B --> POD: Learnings
    POD --> MergeOracle: Sync state
    MergeOracle --> Winner: Synthesis
    Winner --> [*]: Final Merge
```

## 6. Super Intellect Stack (Language)

```mermaid
graph BT
    L1["File / Raw Code"] --- L2["JSON Objects"]
    L2 --- L3["MCP Tools"]
    L3 --- L4["Grain Primitives"]
    L4 --- L5["Thought (Natural Language)"]
    
    subgraph Stack["Nexus Prime Layer"]
        L4
    end

## 7. Request Handling Lifecycle (Detailed)

```mermaid
sequenceDiagram
    participant U as User / Agent (Cursor/Claude)
    participant M as MCP Adapter
    participant G as MindKit Guardrails
    participant T as Token Optimizer
    participant E as Core Engines (Memory/Evolution)
    participant W as Phantom Workers
    
    U->>M: Call Tool (e.g., nexus_spawn_workers)
    M->>G: nexus_mindkit_check(action, files)
    G->>G: Static AST Analysis
    G-->>M: PASS (Score: 0.95)
    M->>T: nexus_optimize_tokens(task, files)
    T->>T: Greedy Knapsack Optimization
    T-->>M: Reading Plan (READ/OUTLINE/SKIP)
    M->>E: Execute Logic
    E->>E: Memory Recall (Semantic/Vector)
    E->>W: Spawn parallel worktrees (Git Worktrees)
    W-->>E: POD Network Learning Broadcast
    E->>E: Merge Oracle (Synthesis)
    E->>E: Store Experience (Hippocampus -> Cortex)
    E-->>M: Final Result (Confidence: 0.9)
    M-->>U: JSON-RPC Response
```

## 8. Language Specifications & Semantic Encoding

Nexus Prime's internal representation uses oscillatory wave patterns to represent code logic across different languages.

```mermaid
flowchart LR
    File["Source Code (.ts, .py, .go)"] --> Parse["Structural Parsing (AST/Logic)"]
    Parse --> Signature["Identify Functional Signatures"]
    Signature --> Encode["WaveEncoder (Oscillatory Patterns)"]
    
    subgraph Semantic["Universal Semantic Layer"]
        Encode --> Wave["WavePattern { amplitude, phase, freq }"]
        Wave --> Energy["Attention Equilibrium (TF-IDF/Graph)"]
    end
    
    Energy --> Decode["Pattern Decoder"]
    Decode --> Action["Agent Execution / Tool Output"]
    
    style Semantic fill:#0f172a,stroke:#3b82f6,color:#fff
```
```
