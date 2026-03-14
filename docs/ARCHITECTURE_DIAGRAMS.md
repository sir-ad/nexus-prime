# Nexus Prime Architecture Diagrams

This document mirrors the shipped public architecture page and describes the system that is currently exposed in the product.

## 1. Control Plane and Entrypoints

```mermaid
flowchart LR
    Client["Client (Codex, Cursor, Claude, Windsurf, Antigravity)"]
    Bootstrap["nexus_session_bootstrap"]
    Orchestrate["nexus_orchestrate"]
    Plan["nexus_plan_execution (optional)"]
    Runtime["SubAgent Runtime"]
    Dashboard["Dashboard + API"]

    Client --> Bootstrap
    Bootstrap --> Plan
    Bootstrap --> Orchestrate
    Plan --> Orchestrate
    Orchestrate --> Runtime
    Runtime --> Dashboard
    Runtime --> Client
```

## 2. Orchestration Contract

```mermaid
flowchart TD
    Start["Bootstrap session"]
    Recall["Recall memory + stats"]
    Decompose["Task graph + worker plan"]
    Budget["Source-aware token budget"]
    Score["Artifact scoring"]
    Audit["Artifact selection audit"]
    Execute["Runtime execution"]
    Verify["Verification + governance"]
    Learn["Learning + continuation decision"]

    Start --> Recall --> Decompose --> Budget --> Score --> Audit --> Execute --> Verify --> Learn
```

## 3. Worktree Execution Lifecycle

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant D as Worktree Doctor
    participant G as Git Worktree
    participant C as Coder Worker
    participant V as Verifier
    participant R as Runtime Snapshot

    O->>D: inspect + prune stale metadata
    D-->>O: health snapshot
    O->>G: git worktree add --detach
    G-->>C: isolated worktree
    C->>V: handoff candidate patch
    V->>R: record verification result + worktree health
    V->>G: cleanup worktree
    G-->>R: cleanup status
```

## 4. Memory Fabric and Reconciliation

```mermaid
flowchart LR
    Input["Run output / worker output / operator note"]
    Extract["Fact extractor"]
    Reconcile["Memory reconciler"]
    Decision{"Action"}
    Graph["Graph projector"]
    Vault["Vault projector"]
    Scopes["Session / Shared / Project / User / Promoted"]

    Input --> Extract --> Reconcile --> Decision
    Decision -->|ADD / UPDATE / MERGE| Graph
    Decision -->|QUARANTINE / DELETE / NONE| Scopes
    Graph --> Vault
    Vault --> Scopes
```

## 5. RAG Ingestion and Retrieval Gate

```mermaid
flowchart TD
    Source["File / URL / Raw text"]
    Ingest["Chunk + embed + tag"]
    Attach["Attach collection to runtime"]
    Gate["RAG gate"]
    Select["Top matching chunks"]
    Drop["Dropped by budget"]
    Packet["Planner / packet / runtime context"]
    Memory["Distilled facts only"]

    Source --> Ingest --> Attach --> Gate
    Gate --> Select --> Packet
    Gate --> Drop
    Packet --> Memory
```

## 6. Source-Aware Token Budget

```mermaid
flowchart TD
    Sources["Repo + Memory + RAG + Patterns + Runtime traces"]
    Rank["Rank by relevance, trust, and cost"]
    Allocate["Allocate by phase"]
    Keep["Selected context"]
    Skip["Dropped context"]
    Trace["Persisted by-source telemetry"]

    Sources --> Rank --> Allocate
    Allocate --> Keep
    Allocate --> Skip
    Keep --> Trace
    Skip --> Trace
```

## 7. Dashboard and Runtime Truth Data Flow

```mermaid
flowchart LR
    Runtime["Runtime snapshot"]
    Registry["Runtime registry"]
    API["Dashboard API"]
    UI["Dashboard views"]
    Inspector["Inspector + event stream"]

    Runtime --> Registry --> API --> UI
    Registry --> Inspector
    API --> Inspector
```

## 8. CI and Release Pipeline

```mermaid
flowchart LR
    PR["Pull request"]
    Quality["Build + lint + tests + pack dry-run"]
    Audit["Dependency audit + workflow lint"]
    Smoke["Bootstrap + setup + dashboard + MCP smoke"]
    Merge["Merge to main"]
    Pages["Docs deploy"]
    Release["GitHub release + npm publish"]

    PR --> Quality --> Audit --> Smoke --> Merge --> Pages --> Release
```
