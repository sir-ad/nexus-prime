# Changelog

All notable changes to Nexus Prime will be documented in this file.

## [3.9.0] - 2026-03-12

### Added
- **Instruction Gateway**: Added a shared `InstructionGateway` that compiles `AGENTS.md`, `.agent/rules/*`, and runtime-selected context into a deduplicated, token-budgeted instruction packet for active runs.
- **Cross-Client Instruction Envelopes**: Added packet renderers for Codex, Claude Code, Antigravity/OpenClaw, Cursor, Windsurf, and Opencode so every high-level client path consumes one compiled protocol instead of adapter-specific stubs.
- **Execution Ledger Surfaces**: Added persisted execution ledger tracking plus dashboard APIs for `/api/orchestration/ledger` and `/api/instruction-packet`.
- **Release Notes Artifact**: Added release notes for this version under `releases/v3.9.0.md`.

### Changed
- **High-Level Runtime Enforcement**: Orchestrated runs now compile and persist instruction packets, planner/token-optimization status, and machine-readable step outcomes before entering runtime execution.
- **Human vs Machine Protocol Split**: Reduced `AGENTS.md` into a compact human operator manual and moved the durable machine-facing protocol path to `.agent/rules/*` plus `.agent/runtime/packet.json` and `.agent/runtime/packet.md`.
- **Dashboard Runtime Truth**: The dashboard now shows execution mode, latest packet, latest ledger, and clearer empty token-state messaging from persisted runtime snapshots.

### Fixed
- **Antigravity / OpenClaw Stub Behavior**: Replaced log-only adapter behavior with real packet rendering over the shared instruction gateway.
- **Execution Truth Drift**: Internal continuation runs no longer overwrite the canonical packet-bearing orchestration snapshot for the parent runtime.
- **Prompt Noise Regression**: Compiled packets now deduplicate repeated AGENTS/rules sections and avoid dumping the full installed skill catalog into model-facing context.

## [3.8.0] - 2026-03-11

### Added
- **Autonomy Orchestrator**: Added an orchestrator-first control plane that classifies raw prompts, loads memory/session context, decomposes work, selects crews/specialists/skills/workflows/hooks/automations, and prepares the runtime package before execution.
- **Primary MCP Entry Point**: Added `nexus_orchestrate` for bounded autonomous raw-prompt execution, plus read-only discovery APIs for `nexus_list_skills`, `nexus_list_workflows`, `nexus_list_hooks`, and `nexus_list_automations`.
- **Persisted Orchestration Telemetry**: Added per-runtime orchestration snapshots, session state, token summaries, token timelines, and per-run token drilldowns in the runtime registry.
- **Dashboard Control-Plane APIs**: Added `/api/orchestration/session`, `/api/tokens/summary`, `/api/tokens/timeline`, `/api/tokens/runs/:runId`, and `/api/clients/primary`.
- **Release Notes Artifact**: Added release notes for this version under `releases/v3.8.0.md`.

### Changed
- **High-Level Execution Routing**: `NexusPrime.execute`, dashboard runtime execution, and orchestrator-backed flows now enter through the orchestrator instead of bypassing it straight into `runtime.run()`.
- **Token Console Behavior**: The dashboard token meter now shows lifetime persisted compression totals immediately after restart and exposes a token analyzer drawer with subsystem, phase, and run breakdowns.
- **Client Presence Model**: Connected ecosystem detection now uses explicit precedence so active Codex sessions outrank stale Claude footprints, while installed-but-idle clients remain visible.
- **Agent Protocol Docs**: Rewrote `AGENTS.md` as an orchestrator-first operating manual with context-acquisition order, subsystem trigger guidance, task recipes, and worker context handoff rules.

### Fixed
- **Dashboard Truth Drift**: Shared dashboard hosts now resolve orchestration, token, and client state per selected runtime instead of leaking host-process truth across reused sessions.
- **Token Event Type Drift**: Expanded the event-bus token payload contract so richer token telemetry no longer depends on untyped runtime/orchestrator emissions.
- **Session Identity Access**: Added direct session-id access in Session DNA so orchestrator session state stays aligned with the active runtime handoff.

## [3.7.0] - 2026-03-11

### Added
- **Shared Runtime Registry**: Added a filesystem-backed per-runtime snapshot registry so active Nexus runtimes can publish their own usage truth across process boundaries.
- **Runtime Usage APIs**: Added dashboard-facing `/api/runtimes` and `/api/usage` surfaces for per-runtime visibility into memories, skills, roster, crews, planning, workflows, hooks, automations, governance, and federation.
- **Worker Context Packets**: Added canonical worker context payloads plus `context.json` and `context.md` artifacts under worker outputs and `.agent/runtime/` worktrees.
- **Local Override Conventions**: Added project-local `.agent/hooks` and `.agent/automations` directories plus a convention note for runtime handoff context.

### Changed
- **Runtime Consumption**: Active skills, workflows, specialist profile excerpts, review gates, and hook-added phase context now flow into worker manifests and deterministic execution instead of remaining mostly metadata.
- **Dashboard Truth Model**: The shared dashboard can now reuse a host process without conflating that host's in-memory state with another runtime's activity, and the UI exposes runtime selection with explicit used/stale/not-used states.
- **Automation Lifecycle**: Queued automation follow-up runs now execute through a bounded continuation path with parent/source tracking and loop suppression.
- **Federation Status Surface**: Federation snapshots now include explicit relay configuration and degradation details instead of implying that NexusNet relay operations are live.
- **Agent Protocol Docs**: Updated AGENTS guidance to reflect planner surfaces, enforced two-coder minimums, and `.agent/runtime` worker context handoff.

### Fixed
- **Hook Propagation Gaps**: `before-mutate` and `before-verify` hook outputs now patch live manifests, actions, verify commands, and context artifacts instead of being recorded without effect.
- **Memory Dispatch Truthfulness**: Nexus-owned memory stores now route through runtime dispatch so `memory.stored` hooks and automations fire exactly once.
- **POD Minimum Enforcement**: Runtime worker selection now clamps coder counts to a minimum of two, matching the documented protocol.
- **Shared Dashboard Misreporting**: Reused dashboard hosts no longer make a newer runtime look idle just because the host process did not own that activity.

## [3.6.0] - 2026-03-11

### Added
- **Native Specialist Roster**: Added a generated first-party specialist corpus plus crew templates for PDLC, implementation, GTM, content, finance, security, and research motions.
- **Task Planner Overlay**: Added a non-regressing planner layer that emits objective, crew, specialist, skill, workflow, tool, swarm, fallback, review-gate, and continuation state before execution.
- **Planner MCP APIs**: Added `nexus_plan_execution`, `nexus_list_specialists`, and `nexus_list_crews` so MCP clients can inspect the planner and roster without executing mutations.
- **Planner Dashboard Surfaces**: Added specialist, crew, and live planner-ledger views to the topology console, backed by `/api/specialists`, `/api/crews`, and `/api/runtime/plan`.

### Changed
- **Runtime Worker Assignment**: Execution runs now persist `plannerState`, assign specialists to worker manifests, and emit `planner.stage` events into the runtime ledger and dashboard stream.
- **NXL / Orchestrator Integration**: Crew selectors, specialist selectors, and optimization profile now flow through NXL compilation, swarm orchestration, runtime planning, and run-status reporting.
- **Planner Safety Model**: The specialist planner remains an additive overlay and can be disabled with `NEXUS_SPECIALIST_PLANNER_DISABLED=1`, preserving the stable baseline runtime path.

### Fixed
- **Tool Policy Truthfulness**: Planner-selected tool policy is now enforced per worker role instead of remaining metadata-only, while explicit action-driven runs remain backward-compatible.
- **Non-Coder Tool Leakage**: Planner and verifier manifests no longer inherit write-capable tool permissions from mutate specialists when those tools are only meant for coder workers.

## [3.5.0] - 2026-03-11

### Added
- **Expanded Living Product Brain**: Added broader bundled skill/workflow coverage for PDLC, GTM, writing, deep-tech, API, data, Python, Django, TypeScript, Node, React, AI, security, economics, plus builder/operator and approval-loop artifact families.
- **Hook Runtime**: Added first-class hook artifacts with checkpoint/event triggers for `run.created`, `before-read`, `before-mutate`, `before-verify`, `retry`, `run.failed`, `run.verified`, `promotion.approved`, `memory.stored`, and `shield.blocked`.
- **Automation Runtime**: Added first-class automation artifacts for event-driven, scheduled, and connector-bound workflows, including bounded follow-up execution and connector delivery records.
- **Security Shield**: Added a final shield layer for patch apply, promotion, connector delivery, and memory governance decisions with `allow`, `warn`, `quarantine`, and `block` outcomes.
- **Memory Audit Surfaces**: Added structured memory checks, audit reports, duplicate/contradiction detection, quarantine listing, and promotion-safety signals.
- **Federation State Model**: Replaced the mock federation surface with a real local-federation snapshot containing peer inventory, heartbeat aging, relay learnings, and published traces.
- **New MCP / CLI / Dashboard APIs**: Added hook, automation, memory-audit, and federation control/read surfaces across runtime APIs.

### Changed
- **Runtime Ledger**: Execution runs now record active hooks, active automations, shield decisions, memory checks, and federation state alongside skills, workflows, verifier evidence, and promotions.
- **Runtime Lifecycle**: Hook dispatch, automation dispatch, memory checks, and shield evaluation now participate directly in the real execution path instead of being external concepts.
- **Dashboard APIs**: Added `/api/hooks`, `/api/automations`, `/api/memory/audit`, `/api/memory/quarantine`, and `/api/federation`, plus deploy/run routes for hooks and automations.
- **CLI Execution Inputs**: `nexus-prime execute` now accepts hook selectors, automation selectors, shield policy, and memory policy.

### Fixed
- **Release Metadata Drift**: Synchronized the package lockfile version with the package version at `3.5.0`.
- **Federation Truthfulness**: Removed the fake gist-style publish IDs from the federation engine and replaced them with local-federation state and auditable trace handling.
- **Memory Safety Gates**: High-risk secret-bearing memories and unsupported claim patterns are now flagged before promotion-oriented use.

## [3.2.2] - 2026-03-09

### Added
- **Dashboard Compatibility Contract**: Added `dashboardApiVersion`, route capability flags, dashboard mode, and active dashboard URL to `/api/health` so clients can detect stale or incompatible dashboard servers.
- **Occupied-Port Compatibility Coverage**: Added dashboard integration coverage for incompatible-listener fallback and compatible-listener reuse on the default dashboard port.

### Changed
- **Dashboard Startup Behavior**: Replaced silent `EADDRINUSE` bridging with a compatibility probe that reuses only compatible listeners and otherwise starts a fresh dashboard on the next free local port.
- **Partial Dashboard Hydration**: Reworked the topology console to hydrate each resource independently instead of failing the whole page when one API route is missing or unhealthy.
- **Dashboard Density**: Reduced typography and rail padding across the topology console so the three-column layout reads more cleanly under live runtime data.

### Fixed
- **Empty Dashboard on Active MCP**: Fixed the stale-process failure where an old MCP/dashboard server could serve the latest HTML shell but not the newer `/api/*` routes, leaving the dashboard visually empty.
- **Legacy Stream Rendering**: Normalized legacy SSE event payloads in the browser so the live stream no longer degrades into repeated `n/a` cards when older event shapes appear.

## [3.2.1] - 2026-03-09

### Added
- **Topology-First Dashboard APIs**: Added `/api/memory`, `/api/memory/:id`, `/api/memory/:id/network`, `/api/pod`, `/api/pod/:workerId`, `/api/clients`, and `/api/events` to back the restored dashboard with real runtime data.
- **Client Registry**: Added a heartbeat-first, heuristic-second client registry that surfaces Codex, Claude Code, Antigravity, Opencode, and MCP presence with truthful status aging.
- **Dashboard Control Plane**: Added safe local dashboard `POST` routes for runtime execution plus skill, workflow, and client actions.

### Changed
- **Dashboard UX**: Replaced the card-heavy runtime console with the earlier topology-first layout: ecosystem rail, center graph canvas, live stream rail, and a persistent inspector drawer.
- **Runtime Resilience**: Dashboard run listings now fall back to persisted run artifacts so recent executions survive refresh and process boundaries.
- **Memory Surface**: Memory snapshots now expose lineage, linked memories, artifact-derived references, and network DTOs for interactive inspection.

### Fixed
- **POD Visibility**: Promoted POD signals to typed event-bus events and added worker/tag/confidence summaries for the dashboard.
- **Dashboard Smoke Coverage**: Expanded integration coverage to verify the restored shell, graph data APIs, client visibility, and guarded control-plane actions.

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
