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
```
