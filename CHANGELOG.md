# Changelog

All notable changes to Nexus Prime will be documented in this file.

## [3.2.0] - 2026-03-09

### Added
- **Bundled Domain Packs**: Added built-in skill and workflow packs for marketing, product, backend, frontend, sales, finance, workflows, and orchestration, with project-local `.agent` overrides.
- **Workflow Runtime**: Added first-class workflow artifacts, deployment state, derivation hooks, runtime application, and MCP workflow control surfaces.
- **Backend Registry**: Added selectable runtime backend registry for temporal/hyperbolic memory, meta-compression, deterministic NXL compilation, and experimental AgentLang/neural compilation.
- **Runtime Control MCP Tools**: Added `nexus_skill_generate`, `nexus_skill_deploy`, `nexus_skill_revoke`, `nexus_workflow_generate`, `nexus_workflow_deploy`, `nexus_workflow_run`, and `nexus_run_status`.
- **Dashboard APIs and Smoke Coverage**: Added `/api/runs`, `/api/runs/:id`, `/api/skills`, `/api/workflows`, `/api/backends`, `/api/health`, plus a dashboard integration test.

### Changed
- **Execution Graph Topology**: Promoted the shared runtime to a multi-role execution graph with planner, coder, verifier, skill-maker, and research-shadow manifests, verification results, promotion decisions, workflow events, and backend evidence.
- **Truthful CLI and MCP Surfaces**: CLI execution now accepts skill, workflow, and backend selectors; swarm and NXL responses now expose planner summaries, workflows, promotions, and backend selections.
- **Dashboard UX**: Rebuilt the dashboard into a live runtime console backed by the execution ledger and SSE stream instead of static telemetry panels.
- **Package Version**: Bumped package metadata to `3.2.0`.

### Fixed
- **Pages Deployment Workflow**: Fixed GitHub Pages environment URL syntax in `.github/workflows/pages.yml`.
- **Lint Gate**: Removed the runtime-blocking regex lint errors so `npm run lint` is green again.
- **Memory Backend Extensibility**: Added `MemoryEngine.snapshot()` so promoted temporal/hyperbolic ranking can operate on real persisted memories.

## [3.1.0] - 2026-03-09

### Added
- **Real Sub-Agent Runtime**: Added a shared worktree-backed execution kernel that powers single-agent execution, swarms, MCP runtime calls, and NXL runs with artifact trails, verifier workers, rollback, and merge decisions.
- **Runtime Skill Fabric**: Added live runtime skill artifacts, guarded hot deployment, deployment tracking, and promotion/revocation hooks for read/orchestrate/mutate skill classes.
- **Backend Contracts**: Added explicit memory, compression, consensus, and DSL compiler backend interfaces so research-track implementations can run in shadow or experimental mode behind the same runtime.
- **CLI Execution Inputs**: `nexus-prime execute` now supports `--actions-file`, `--verify`, `--workers`, and `--nxl-file` for real runtime execution instead of demo-only task strings.
- **Release Draft Artifact**: Added a release-notes draft for this version under `releases/v3.1.0.md`.

### Changed
- **Truthful MCP Runtime Surfaces**: `nexus_spawn_workers` and `nexus_execute_nxl` now execute real worktree runs and return execution state, artifacts, verified worker counts, and backend selections.
- **Truthful Public API**: `execute()` and `executeSwarm()` now route through the shared runtime and return real execution objects instead of simulated success text.
- **Headless/Test Harness**: The test runner now builds first and runs with native Node against `dist/` modules instead of relying on missing `tsx`.
- **README Runtime Docs**: Updated README examples and swarm language to describe actual verified execution flow.

### Fixed
- **Untracked File Diffs**: Worker patch capture now stages untracked files before diffing so newly created files are included in verifier and final merge patches.
- **Runtime Skill Patch Contamination**: Excluded `.agent` runtime skill overlays from repo patches so verifier worktrees do not fail on duplicate skill files.
- **Worktree Ref Conflicts**: Switched worker worktrees to detached HEAD mode to avoid branch ref lock failures during repeated or parallel execution.
- **Configurable State Paths**: Memory DB and POD message storage can now be redirected for sandboxed/headless environments, with tmp fallbacks where needed.
- **Headless Dashboard Startup**: Dashboard startup can now be disabled explicitly for CI and runtime tests.

## [1.4.0] - 2026-03-06
### Added
- **Multi-Tool MCP Integration**: Support for Cursor, Claude Code, Opencode, Kilocode, and Codex.
- **`nexus-prime setup` CLI**: Automated configuration for popular AI coding environments.
- **Ecosystem Dashboard**: New "Connected Ecosystem" panel to visualize integration status.
- **Refined MCP Adapter**: Enhanced tool metadata and descriptions for better discovery.

### Documentation
- New `INTEGRATIONS.md` guide with step-by-step instructions.
- README update with supported clients list and automated setup guide.

## [1.3.0] - 2026-03-05

### Added
- **Deep-Tech Documentation Overhaul**: Completely rewrote the `README.md` and `docs/index.html` adopting a granular, intellectual, brutalist aesthetic. Shifted from "meta-leader" metaphors to structural, system-level descriptions (Information Architecture, Memory Topology, Swarm Topology).
- **Five Pillars of Agent Intelligence**: Promoted the **Entanglement Engine (Phase 9A)** to a top-level feature. Agents now share a quantum-state vector in a Hilbert space, collapsing via Born rule sampling for correlated decisions without explicit IPC.
- **Merge Oracle**: Heavily documented the Oracle's use of Byzantine consensus, Pearson correlation, and AST-level Hierarchical Synthesis.
- **Advanced CLI UX visualizations**: Added new MCP tools (`nexus_decompose_task` and `nexus_assemble_context`) that output beautiful ASCII data trees directly into the agent's CLI feed.
- **Executive HITL Checkpoints**: Implemented `nexus_request_affirmation` for blocking dangerous operations behind explicit human approval in the chat.
- **Auto-Gist Syncing**: `nexus_store_memory` now automatically relays high-priority (>=0.8) findings to a GitHub Gist vault.

## [1.2.0] - 2026-03-04

### Added
- **Premium Documentation**: Consolidated all `.md` files into a single, comprehensive `README.md` with PM Agent lens value propositions and GitHub alerts.
- **Matrix-style Dashboard**: Upgraded MCP telemetry output to an ultra-clean, structured matrix format.
- **Cross-process EventBus**: Dashboard now supports live metrics from MCP instances via file-polling telemetry bridging.
- **Robust Consensus Engine**: Replaced random stubs with task-aware Jaccard similarity voting, true gossip convergence, and G-Counter CRDTs.
- **Code-aware CAS Tokenizer**: Attention Stream (CAS) now tokenizes by CamelCase, punctuation, and whitespace for massive compression gains.
- **Darwin Loop Validation**: Pre-flight build step validation before evolved hypotheses can be applied.

### Fixed
- **Dashboard Empty State**: Addressed architecture split by streaming events directly.
- **Memory Safety**: `MemoryEngine.flush()` is now wrapped in a transaction with deep JSON sanitization, preventing `RangeError` panics on MCP shutdown.
- **NPM Provenance Failing**: Normalized `package.json` bins and repositories using `npm pkg fix` to enable automated GitHub Actions CI.
