<div align="center">
  <h1>🧬 Nexus Prime</h1>
  <p><strong>Local-first MCP control plane for coding agents</strong></p>

  [![npm version](https://img.shields.io/npm/v/nexus-prime?style=for-the-badge&color=00ff88)](https://www.npmjs.com/package/nexus-prime)
  [![npm downloads](https://img.shields.io/npm/d18m/nexus-prime?style=for-the-badge&color=00d4ff)](https://www.npmjs.com/package/nexus-prime)
  [![License: MIT](https://img.shields.io/badge/License-MIT-00d4ff?style=for-the-badge)](LICENSE)
  [![Agentic OS](https://img.shields.io/badge/Ecosystem-Agentic_OS-8b5cf6?style=for-the-badge)](https://github.com/topics/agentic-os)
  [![Build Status](https://img.shields.io/badge/build-passing-success?style=for-the-badge)](https://github.com/sir-ad/nexus-prime/actions)
  [![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-339933?style=for-the-badge&logo=node.js)](https://nodejs.org)
  <!-- traffic-badges:start -->
  [![Views](https://img.shields.io/endpoint?style=for-the-badge&logo=github&url=https%3A%2F%2Fgist.githubusercontent.com%2Fsir-ad%2Fbbf9ebc77ccb2097ccf760bec3825ab7%2Fraw%2Fviews.json)](https://github.com/sir-ad/nexus-prime)
  [![Clones](https://img.shields.io/endpoint?style=for-the-badge&logo=github&url=https%3A%2F%2Fgist.githubusercontent.com%2Fsir-ad%2Fbbf9ebc77ccb2097ccf760bec3825ab7%2Fraw%2Fclones.json)](https://github.com/sir-ad/nexus-prime)
  <!-- traffic-badges:end -->
  
  <!-- AI / Agentic Widgets -->
  [![AI Framework](https://img.shields.io/badge/AI-Framework-FF9900?style=for-the-badge)](https://github.com/topics/ai)
  [![LLM Ready](https://img.shields.io/badge/LLM-Ready-00A67E?style=for-the-badge)](https://github.com/topics/llm)
  [![MCP Protocol](https://img.shields.io/badge/Protocol-MCP-4285F4?style=for-the-badge)](https://modelcontextprotocol.io/)

  <p><i>Bootstrap. Orchestrate. Verify. Learn.</i></p>
</div>

---

### ⚡ Quick Install
```bash
# Global installation (recommended)
npm i -g nexus-prime

# Run directly
npx nexus-prime mcp
```

---

**Nexus Prime** is a local-first MCP control plane for coding agents. Run it as an MCP server or integrate it programmatically to give your client **persistent memory, orchestrator-first execution, token-aware file routing, crews/specialists/skills/workflows selection, runtime truth in the dashboard, and verified worktree-backed execution.**

### Default external-client path
```txt
nexus_session_bootstrap(goal, files?)
nexus_orchestrate(prompt="<raw user request>")
```

Use `nexus_plan_execution` only when you explicitly want a plan before mutation. Let Nexus choose crews, specialists, skills, workflows, hooks, automations, worker count, and token strategy unless you need hard constraints.

**Website:** [sir-ad.github.io/nexus-prime](https://sir-ad.github.io/nexus-prime/)
**Documentation:** [Knowledge Base](https://sir-ad.github.io/nexus-prime/knowledge-base.html) · [Integrations](https://sir-ad.github.io/nexus-prime/integrations.html) · [Architecture Diagrams](https://sir-ad.github.io/nexus-prime/architecture-diagrams.html)

---

<details>
<summary><b>📐 Topology (System Architecture)</b></summary>

Nexus Prime operates as a **Stateful Middleware Layer** between the driving LLM and the filesystem.

- **Adapter Layer (MCP):** Translates standard JSON-RPC tool calls into engine-specific instructions.
- **Orchestration Hub:** Manages the lifecycle of Phantom Workers and POD synchronization.
- **Engine Core:** Contains individual modules for Memory (Cortex), Token Optimization (HyperTune), and Evolution.
- **Storage Substrate:** A dual-layer SQLite storage (Local Cortex) and Distributed Memory Relay (NexusNet).

```mermaid
graph TD
    User([User/Agent]) --> MCP[MCP Adapter]
    MCP --> Guard[MindKit Guardrails]
    Guard --> TO[Token Optimizer]
    TO --> Engine{Core Engines}
    Engine --> Sync[POD Network]
    Engine --> Mem[3-Tier Memory]
    Sync --> Workers[Phantom Workers]
```
</details>

<details>
<summary><b>📜 Language Specifics (NXL Spec)</b></summary>

The **Nexus eXpansion Language (NXL)** is a declarative syntax used to define agent archetypes and swarm behaviors without hard-coding logic.

- **Archetypes:** Define agent "personalities" and tool-access permissions.
- **Induction Rules:** Logical triggers for spawning parallel workers (e.g., `if (file_count > 3 && risk > 0.7) spawn()`).
- **Swarm Directives:** Templates for coordinated multi-agent activities.

```yaml
# Example NXL Archetype
archetype: "ForensicArchitect"
capabilities: [graph_traverse, deep_audit, evolution_check]
induction:
  trigger: "large_rewrite"
  workers: 4
  consensus: "byzantine_fault_tolerant"
```
</details>

<details>
<summary><b>🛠️ Building on Nexus Prime (Integration Guide)</b></summary>

Developers can extend Nexus Prime by registering custom **Skill Cards** or hooking into the **POD Network**.

1.  **Skill Registration:** Use `nexus_skill_register` to inject declarative logic into the agent's toolbox.
2.  **Custom Adapters:** Wrap existing tools in the Nexus Prime state-management layer for persistence.
3.  **Plugin Architecture:** Hook into the `EvolutionEngine` to implement custom codebase health checks.

```bash
# Registering a custom skill
nexus_skill_register --card ./my-custom-skill.yml
```
</details>

<details>
<summary><b>📊 Operational Differences</b></summary>

| Concern | Direct agent-to-filesystem flow | Nexus Prime flow |
| :--- | :--- | :--- |
| Session start | Depends on repo docs and ad-hoc browsing | `nexus_session_bootstrap` recovers memory and recommends the next step |
| Multi-step execution | Manual tool chaining | `nexus_orchestrate` selects crews, specialists, skills, workflows, hooks, automations, and token strategy |
| Token discipline | Caller-managed | Optimizer and runtime record whether token routing was applied or skipped |
| Runtime truth | Depends on the current host process | Shared runtime snapshots back the dashboard and API surfaces |
| Follow-up learning | Optional and easy to skip | Session DNA, memory storage, and execution ledgers are first-class runtime outputs |

</details>

---

## 🏛️ Architecture & Swarm Topology

Nexus Prime enables true parallelization by isolating agents into dynamically generated Git worktrees. Inter-worker communication happens over the local **POD Network**, and merges are mediated by the **Merge Oracle**.

```mermaid
sequenceDiagram
    participant U as User / Agent (Cursor/Claude)
    participant M as MCP Adapter
    participant G as MindKit Guardrails
    participant T as Token Optimizer
    participant E as Core Engines (Memory/Evolution)
    participant W as Phantom Workers
    
    U->>M: Call Tool (e.g., nexus_spawn_workers)
    M->>G: nexus_mindkit_check()
    G-->>M: PASS / FAIL
    M->>T: nexus_optimize_tokens()
    T-->>M: Reading Plan (READ/OUTLINE/SKIP)
    M->>E: Execute Logic
    E->>W: Spawn parallel worktrees (if needed)
    W-->>E: Results
    E->>E: Store Experience (Cortex/Zettelkasten)
    E-->>M: Final Result
    M-->>U: JSON-RPC Response
```

### 🐝 Phantom Swarm Execution Topology

The original Phantom concept remains central to Nexus Prime: `GhostPass()` evaluates risk, workers execute in isolated worktrees, shared runtime context keeps them aligned, and the merge layer decides what lands back on the main branch.

```text
┌─────────────────────────────────────────────────────────────────────┐
│ SWARM EXECUTION TOPOLOGY                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [Main Branch] ──▶ GhostPass() (Risk Analysis)                      │
│                          │                                          │
│           ┌──────────────┼──────────────┐                           │
│           │              │              │                           │
│     [Worktree A]   [Worktree B]   [Worktree C]                      │
│     (UX Agent)     (API Agent)    (DB Agent)                        │
│           │              │              │                           │
│           └────┬─────────┴─────────┬────┘                           │
│                │                   │                                │
│                ▼                   ▼                                │
│        Shared Runtime Context (correlated worker state)             │
│                │                                                    │
│                ▼                   ▼                                │
│      Merge Oracle (Byzantine Consensus + Hierarchical Synthesis)    │
│                │                                                    │
│                ▼                                                    │
│  [Main Branch] ◀── Commit & State Collapse                          │
└─────────────────────────────────────────────────────────────────────┘
```

<div align="center">
  <img src="./docs/assets/screenshots/dashboard_v3.8.0.png" alt="Nexus Prime dashboard showing runtime truth, token telemetry, knowledge fabric, and operator actions">
  <br>
  <i>Current dashboard overview: runtime truth, lifetime token telemetry, and knowledge fabric in one operator view.</i>
</div>

### Execution Protocol (Agent Orchestrator)

When invoking `nexus_spawn_workers`, workflow execution, or a runtime swarm task, Nexus Prime follows explicit routing patterns rather than improvised worker fan-out:

| Request Intent | Sub-Agents Spawned | Execution Order |
| :--- | :--- | :--- |
| Full stack feature | UX Designer + Backend Engineer | Parallel, cross-communicating via POD |
| Database migration | DB Architect + Backend Engineer | Sequential, schema first |
| Bug hunt | 3x QA / verifier workers | Parallel competitive |
| Refactor module | Senior Coder + Security / verifier pass | Sequential pipeline |

```typescript
import { PhantomSwarm } from 'nexus-prime/orchestrator';

const swarm = new PhantomSwarm();

const results = await swarm.dispatch({
  goal: 'Migrate user settings to Postgres',
  agents: ['db-migrator', 'api-refactor'],
  topology: 'parallel-mesh',
});

swarm.on('consensus.reach', (state) => {
  console.log(`Merged ${state.filesResolved} files with ${state.confidence}% certainty.`);
});
```

---

## 🧠 Core Capabilities

### 1. 3-Tier Semantic Memory (Cortex)
<details>
<summary><b>View Details</b></summary>
Solves the "catastrophic forgetting" problem. Every insight is tagged, prioritized, and linked into a persistent SQLite Zettelkasten.
- **Prefrontal**: Active working set stored in-memory for instant recall.
- **Hippocampus**: Session-level episodic buffer caching recent states.
- **Cortex**: Long-term SQLite storage utilizing Vector embeddings (**HNSW**) and relational graph mapping.
</details>

### 2. Lifetime Token Routing and Telemetry
<details>
<summary><b>View Details</b></summary>
Formulates context selection as a budgeted routing problem, solving for maximum information gain against token cost. The runtime persists token telemetry so the dashboard can show lifetime compression totals, by-source allocation, and per-run drilldowns instead of waiting for live-only events.

<div align="center">
  <img src="./docs/assets/screenshots/dashboard_v3.8.0.png" alt="Nexus Prime dashboard showing session-first RAG collections, source mix, provenance, and by-source token allocation">
  <br>
  <i>Session-first RAG and token budgeting: Nexus retrieves top matching chunks, records provenance, and shows what was selected or dropped.</i>
</div>
</details>

### 3. Phantom Worker Swarms
<details>
<summary><b>View Details</b></summary>
Parallelize complex tasks using isolated Git Worktrees. Ghost Pass performs read-only risk analysis, coder workers execute real file mutations in detached worktrees, verifier workers run build/test commands independently, and the Merge Oracle selects the final patch with an auditable artifact trail.
</details>

### 4. Live Skills, Workflows, and Derivation
<details>
<summary><b>View Details</b></summary>
Nexus Prime now ships bundled domain skill packs and workflow packs for **marketing, product, backend, frontend, sales, finance, workflows, and orchestration**. Runs can generate new skills and workflows, deploy them at runtime checkpoints, and promote them only after verifier evidence plus multi-tier consensus.
</details>

### 5. Runtime Console
<details>
<summary><b>View Details</b></summary>
The built-in dashboard exposes active and recent runs, worker states, verifier results, knowledge collections, backend catalogs, skills, workflows, live events, and docs/release health from the same runtime ledger that powers CLI and MCP execution.
</details>

### 6. Coordination and Continuation Layer
<details>
<summary><b>View Details</b></summary>
Runs carry shared runtime context, review gates, continuation traces, and execution ledgers so follow-up work can stay bounded, inspectable, and governed instead of relying on ad-hoc worker fan-out.
</details>

---

## 🛠️ MCP Control Surfaces

Nexus Prime ships a broad MCP surface, but the default external-client path should stay small:

```txt
nexus_session_bootstrap(goal, files?)
nexus_orchestrate(prompt="<raw request>")
```

These are the most important operator-facing surfaces:

| Tool | Capability | Tier |
| :--- | :--- | :--- |
| `nexus_session_bootstrap` | Recover memory, inspect stats, see the recommended next step | Core |
| `nexus_orchestrate` | Raw-prompt autonomous execution path | Core |
| `nexus_store_memory` | Store finding/insight | Core |
| `nexus_recall_memory` | Semantically recall context | Core |
| `nexus_plan_execution` | Inspect the execution ledger before mutation | Planning |
| `nexus_optimize_tokens` | Manual token-plan inspection or override | Optimization |
| `nexus_spawn_workers` | Execute parallel worktree swarm with verification and artifacts | Autonomy |
| `nexus_mindkit_check` | Guardrail validation | Safety |
| `nexus_ghost_pass` | Pre-flight risk analysis | Analysis |
| `nexus_run_status` | Inspect run ledger state | Runtime |
| `nexus_list_skills` / `nexus_list_workflows` | Inspect available runtime assets when you need explicit control | Runtime |
| `nexus_list_hooks` / `nexus_list_automations` | Inspect operating-layer behavior and follow-up execution | Runtime |

### Real Runtime Execution
```bash
# Execute a real runtime task with explicit actions
nexus-prime execute <agent-id> "apply runtime patch" \
  --files README.md package.json \
  --verify "npm run build" \
  --skills backend-playbook orchestration-playbook \
  --workflows backend-execution-loop \
  --compression-backend meta-compression \
  --actions-file ./actions.json

# Execute an NXL graph directly
nexus-prime execute <agent-id> "ship release workflow" --nxl-file ./plan.nxl.yaml
```

Each run returns a real execution state plus an artifact directory containing manifests, worker diffs, verifier output, and the final merge decision.

---

## 🚀 Get Started

### Supported MCP Clients
Nexus Prime currently provides automated setup for:
- 🔵 **Cursor**
- 🍊 **Claude Code**
- 🟢 **Opencode**
- 🌊 **Windsurf**
- 🛡️ **Antigravity / OpenClaw**

Codex uses the repo-local `AGENTS.md` plus the autonomous MCP profile and does not currently require a separate client-native setup artifact.

### Automated Integration
```bash
# Setup Cursor integration
nexus-prime setup cursor

# Setup Claude Code integration
nexus-prime setup claude

# Setup Windsurf
nexus-prime setup windsurf

# Setup Antigravity / OpenClaw
nexus-prime setup antigravity

# Check all integration statuses
nexus-prime setup status
```

---

## 📜 Changelog
### v3.11.0 "Knowledge Fabric"
- **New Knowledge Fabric layer now assembles bounded execution bundles across repo code, memory, session RAG collections, reusable patterns, and prior runtime traces**
- **Session-first RAG collections and the pattern registry now feed orchestrated runs, runtime truth, and dashboard provenance instead of living outside the control plane**
- **`CI & Publish` now mirrors the real release gate on pull requests with build, lint, full tests, and `npm pack --dry-run` before publish is allowed**
- **RAG collection IDs are sanitized before filesystem access, and remote URL ingestion now times out instead of hanging indefinitely**
- **TypeScript tests and public-surface checks now run through `tsx`, keeping local and GitHub Actions behavior aligned**

### v3.10.0 "Autonomous Bootstrap"
- **New `nexus_session_bootstrap` entrypoint gives external clients one compact session-start tool with memory recall, stats, shortlist guidance, and token-optimization expectations**
- **MCP now defaults to an `autonomous` tool profile, keeping `nexus_session_bootstrap` and `nexus_orchestrate` first while reserving the full expert surface for manual work**
- **`nexus-prime setup` now installs client-native bootstrap instructions for Cursor, Windsurf, Claude Code, Opencode, and Antigravity/OpenClaw**
- **Runtime snapshots now expose bootstrap/orchestrate compliance, recent tool-call chains, and client instruction status in the dashboard truth model**
- **README, docs, and public-surface scanning now align the public story with the real orchestrator-first product and guard against obvious disclosure drift**

### v3.9.0 "Instruction Gateway"
- **Shared instruction gateway compiles AGENTS, `.agent/rules/*`, and runtime selections into a deduplicated packet for every orchestrated run**
- **Cross-client packet renderers now support Codex, Claude Code, Antigravity/OpenClaw, Cursor, Windsurf, and Opencode from one protocol path**
- **Execution ledgers and compiled packets are persisted and exposed in the dashboard via `/api/orchestration/ledger` and `/api/instruction-packet`**
- **AGENTS is now a compact human manual, while `.agent/runtime/packet.json` and `.agent/runtime/packet.md` serve as the machine-facing handoff**
- **Continuation children no longer overwrite the parent runtime's canonical orchestration snapshot**

### v3.8.0 "Orchestrator Control Plane"
- **New `nexus_orchestrate` raw-prompt entrypoint plus discovery APIs for skills, workflows, hooks, and automations**
- **Orchestrator-first execution path now owns intent analysis, context loading, token planning, artifact selection, and bounded autonomous runtime preparation**
- **Persisted orchestration and token telemetry with `/api/orchestration/session`, `/api/tokens/*`, and a dashboard token analyzer**
- **Primary-client precedence now correctly shows active Codex sessions ahead of stale Claude footprints while preserving installed/idle visibility**
- **AGENTS rewritten as an orchestrator-first operating manual with subsystem trigger guidance and worker context handoff rules**

### v3.7.0 "Runtime Truth"
- **Shared runtime registry with `/api/runtimes` and `/api/usage` so the dashboard reports each live runtime truthfully**
- **Worker context handoff artifacts under `.agent/runtime/context.json` and `.agent/runtime/context.md`**
- **Skills, workflows, specialist profile excerpts, review gates, and phase hook effects now feed real worker execution paths**
- **Queued automation follow-up runs now execute with bounded continuation depth and loop suppression**
- **Explicit federation relay status for configured vs degraded NexusNet mode**
- **AGENTS and `.agent` conventions updated to match planner surfaces, runtime handoff, and the enforced 2-coder minimum**

### v3.5.0 "Runtime Intel"
- **Broader built-in skill/workflow packs for PDLC, GTM, writing, deep-tech, API, data, Python, Django, TypeScript, Node, React, AI, security, and economics**
- **First-class HookArtifact runtime with lifecycle checkpoint triggers**
- **First-class AutomationArtifact runtime with bounded follow-up execution and connector delivery records**
- **Balanced SecurityShield for patch apply, promotions, connectors, and memory governance**
- **Memory checks for duplicates, contradictions, secret exposure, unsupported claims, and low-provenance/noise**
- **Real local-federation snapshot with peers, health, relay learnings, and published traces**
- **MCP, CLI, and dashboard support for hooks, automations, memory audit, and federation status**

### v3.4.0 "Dashboard Overhaul"
- **Heartbeat Throttling**: Eliminated refresh storm from client heartbeats — graph stays stable.
- **Smart Empty States**: Token dial, event filters, and graph all show context-aware placeholder UI.
- **14 Default Skills**: session-start-research, prompt-architect, architecture-scout, debug-forensics, refactor-guardian, documentation-writer, dependency-auditor, performance-profiler + original 6.
- **3 Default Workflows**: full-audit-loop, research-and-implement, release-pipeline — auto-seeded on first load.
- **Graph Caching**: Memory topology preserves last-known-good state during refreshes.
- **Version & User Display**: Header now shows package version and git username correctly.
- **README Audit**: Updated changelog, fixed maintainer reference, verified all screenshot paths.

### v3.3.0 "Dashboard Polish"
- **Tool Spend Tracker**: Estimated cost visualization for token usage across sessions.
- **Skill UI**: In-dashboard skill creation form and seed button for default skills.
- **Tool Detection**: Improved client heuristic detection via environment variables and process scanning.
- **Dashboard Stability**: Fixed flickering, memory graph load order, and token dial responsiveness.

### v3.2.0 "Runtime Closure"
- **Topology Console**: Rebuilt dashboard with memory graph, run graph, and POD network visualization.
- **SSE Live Stream**: Server-Sent Events for real-time event broadcasting with exponential backoff.
- **Backend Registry**: Selectable memory, compression, and DSL compiler backends.
- **Security Hardening**: Content Security Policy headers and input sanitization.

### v3.0.0 "The Pulse Update"
- **POD Telemetry**: Real-time heartbeat visualization of worker sync.
- **Improved Tokens**: Optimized HyperTune for large monorepo traversal.

### v1.5.0 "Intelligence Expansion"
- **Mandatory Induction**: Automatically triggers swarms for complex goals (>50 chars).
- **Thermodynamic Memory**: Integrated entropy decay and gravitational attention.
- **Federation Engine**: Automated knowledge sharing via GitHub Gist Relay (NexusNet).
- **NXL Interpreter**: Declarative logic layer for defining agent archetypes.
- **Token Telemetry Console**: Real-time token analytics and runtime visualization.

### v1.4.0
- **Auto-Setup**: Added `nexus-prime setup` for one-click IDE integration.
- **CAS Engine**: Continuous Attention Streams for learned codebook optimization.
- **Git Worktree 2.0**: Improved performance for massive parallelization (>10 workers).

---
<details>
<summary><b>📈 Star History</b></summary>

<div align="center">
  <a href="https://star-history.com/#sir-ad/nexus-prime&Timeline">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=sir-ad/nexus-prime&type=Timeline&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=sir-ad/nexus-prime&type=Timeline" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=sir-ad/nexus-prime&type=Timeline" />
    </picture>
  </a>
</div>

</details>

<br>

<div align="center">
  <strong>License:</strong> MIT <br>
  <strong>Maintainer:</strong> <a href="https://github.com/sir-ad">Adarsh Agrahari (sir-ad)</a>
</div>
