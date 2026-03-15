# Changelog

All notable changes to Nexus Prime are documented here.

Release Index: [v3.13.0](#v3130--2026-03-15) · [v3.12.1 release note](./releases/v3.12.1.md)

<details open>
<summary><b>v3.13.0</b> · 2026-03-15 · Workspace surfaces, dashboard layout fixes, and community presence</summary>

### Added
- **Workspace-driven surfaces**: Each dashboard workspace (overview, knowledge, runs, catalog, governance) now controls its own graph visibility, library tabs, panel titles, and subtitles.
- **Dynamic library tabs**: Library tabs are rendered per workspace instead of a static hardcoded rail; workspace view state is tracked independently.
- **Community badges**: Added Reddit (#1 Post of the Day on r/LLMDevs), Reddit community (r/Nexus_Prime), Discord invite, GitHub stars/forks/issues/last-commit, PRs Welcome, TypeScript, and Open Source badges.
- **Project logo**: Replaced the DNA emoji header with the Nexus Prime hexagon logo.

### Fixed
- **Memory graph overlapping text**: Collapsed focusable-shell gap when the graph widget is hidden in non-graph surfaces, removed conflicting inline `margin-top`, and dropped the `!important` override.
- **Graph note text overflow**: Added `text-overflow: ellipsis` and `white-space: nowrap` to prevent the graph footer note from overflowing into stats on narrow viewports.
- **Responsive hidden-graph surfaces**: Added `min-height: auto` for knowledge, catalog, and governance surfaces at narrow breakpoints so they don't force a tall empty graph panel.

### Changed
- **Knowledge create form**: Auto-opens the RAG create/ingest form when no collections exist.
- **Plan and execute navigation**: Plan and execute actions now switch to the runs workspace and event filter automatically.

</details>

<details open>
<summary><b>v3.12.1</b> · 2026-03-14 · Dashboard focus mode and audit recovery</summary>

### Added
- **Dashboard focus overlay**: Added a shared maximize/restore overlay so graph, memory snapshots, runtime events, operator actions, and major analysis panels can expand into a full workspace without losing state.
- **Project bootstrap RAG seeding**: Added first-run project collection seeding from bounded local repo context so session-first RAG is no longer empty by default.
- **Local operating-layer starters**: Added starter workspace hook and automation files so fresh `.agent/hooks` and `.agent/automations` scaffolds are visible and usable on first run.
- **Graph mirror bootstrap**: Added automatic graph-memory initialization and backfill beside the primary memory store so graph recall and stats are no longer dead on a fresh install.

### Changed
- **Dashboard density**: Tightened rail widths, interior typography, panel spacing, and token-card sizing so the graph-first cockpit fits more usable information without flattening the layout.
- **Knowledge clarity**: Knowledge mode now shows an explicit RAG injection path with attached, retrieved, selected, planner, packet, and runtime usage stages.
- **Memory recall path**: Primary memory recall now blends the working memory engine with graph-mirror matches instead of leaving graph memory disconnected from production reads.
- **Event continuity**: Dashboard event history now rehydrates from persisted JSONL history and rotates archives instead of acting like a fresh-only buffer after restart.

### Fixed
- **Stale token perception**: Token surfaces now refresh on runtime and knowledge activity, making lifetime telemetry feel live without abandoning persisted truth.
- **Dead graph engine**: `graph.db` is created and populated during real production startup rather than only through dormant code paths.
- **Empty first-run knowledge fabric**: Bootstrap/orchestrate now auto-attaches a bounded project context collection when no RAG corpus exists yet.
- **Unbounded event log growth**: Event storage now rotates at 10 MB with retained archives instead of growing forever in one file.

</details>

<details>
<summary><b>v3.12.0</b> · 2026-03-14 · Public surface, proof screens, and release visibility</summary>

### Added
- **Release draft**: Added `releases/v3.12.0.md` so GitHub release publication and npm publish can ship from a complete release artifact.
- **Stable public proof assets**: Added stable screenshot aliases for the graph-first cockpit hero, runtime sequence view, and knowledge trace view so public docs stop depending on version-stamped asset names.
- **Release history surface**: Added a top-level README release-history section that links the latest release note and full changelog.

### Changed
- **README hierarchy**: Rebuilt the README around what Nexus Prime is, why it is different, quick install, the bootstrap-orchestrate path, proof screens, capability families, runtime contract, generated registry, and generated runtime catalog.
- **Website proof layout**: Replaced repeated dashboard imagery with a graph-first hero, a separate runtime-sequence proof module, and a distinct knowledge-trace section while keeping screenshot sizing natural and responsive.
- **Capability story**: Expanded public capability copy so orchestration, worktree-backed swarms, memory fabric, session-first RAG, token budgeting, runtime truth, client bootstrap, and release/governance surfaces read like shipped product behavior rather than terse labels.
- **Generated inventory**: Feature-registry and runtime-catalog markdown now surface compact inventory snapshots and clearer counts for skills, workflows, hooks, automations, crews, specialists, MCP surfaces, client targets, dashboard capabilities, runtime subsystems, and release gates.
- **Docs release framing**: Landing-page changelog, proof captions, and public metadata now align around `v3.12.0` and the current control-plane story.

### Fixed
- **Repeated hero imagery**: The website no longer repeats the same dashboard overview image across multiple sections.
- **Shrunken screenshot presentation**: Public screenshots now render as natural-width proof modules instead of small thumbnails inside oversized containers.
- **Docs/test drift**: README/docs tests and public-surface checks now point at the stable public screenshot names instead of retired overview/knowledge asset names.

</details>

<details>
<summary><b>v3.11.0</b> · 2026-03-12 · Knowledge fabric and release QA hardening</summary>

### Added
- **Knowledge Fabric Layer**: Added a new orchestration-time knowledge fabric that assembles bounded execution bundles across repo context, memory, session RAG collections, reusable patterns, and prior runtime traces.
- **Session-Scoped RAG Collections**: Added first-class RAG collection storage, ingestion, attachment, retrieval, and dashboard/API visibility for session-first corpora.
- **Pattern Registry**: Added a Nexus-native pattern registry for orchestration recipes, RAG patterns, and reusable context overlays without vendoring external app code into the runtime.
- **Release QA Process Artifacts**: Added a pull-request checklist and a release-process checklist so review, QA, and remote deploy expectations are explicit in-repo.
- **RAG Safety Regression Test**: Added `test/rag-collections.test.ts` to cover collection-id filesystem safety and hanging URL ingestion timeouts.

### Changed
- **Token Intelligence**: Token budgeting and telemetry now break down by source class, attached collections, and model-tier traces instead of remaining file-centric.
- **CI Release Gate**: `CI & Publish` now runs the same quality bar as the local release gate on pull requests before any publish path is allowed to proceed.
- **TypeScript Test Execution**: The test suite and public-surface scan now run through `tsx`, keeping local and GitHub Actions execution consistent on Node 20+.
- **Public Changelog Surfaces**: README, docs, and release notes now advertise the new knowledge-fabric and release-hardening state as the current product baseline.

### Fixed
- **Filesystem Traversal in RAG Collections**: Caller-controlled collection IDs are now sanitized before filesystem resolution so traversal-style IDs cannot escape the `rag-collections` store.
- **Hanging Remote RAG Fetches**: URL-based ingestion now times out cleanly instead of waiting indefinitely on slow or misbehaving hosts.
- **CI Runtime Parity**: Release and PR workflows no longer fail on GitHub Actions from direct `node *.ts` execution against ESM TypeScript test files.

</details>

<details>
<summary><b>v3.10.0</b> · 2026-03-12 · Bootstrap-first MCP flow and public trust checks</summary>

### Added
- **Session Bootstrap MCP Entry Point**: Added `nexus_session_bootstrap` so external clients can start from a compact session-start tool that returns client identity, memory recall, stats, shortlist guidance, and token-optimization expectations.
- **Curated MCP Tool Profiles**: Added `NEXUS_MCP_TOOL_PROFILE=autonomous|full`, defaulting to `autonomous`, so external clients see a smaller, sequence-oriented tool surface instead of the full expert catalog.
- **Client-Native Setup Artifacts**: Extended `nexus-prime setup` to install generated instruction artifacts for Cursor, Windsurf, Claude Code, Opencode, and Antigravity/OpenClaw alongside MCP configuration.
- **Public Surface Scan**: Added `test/public-surface.test.ts` plus `npm run test:public` to scan README, docs, releases, and workflow files for stale claims, secret-like patterns, typos, and private-path leaks.
- **Website Favicon**: Added `docs/favicon.svg` so the public docs stop 404ing the favicon request.

### Changed
- **External Client Sequence**: External clients now default to `nexus_session_bootstrap` followed by `nexus_orchestrate`, while planner, hooks, automations, crews, specialists, and token optimization remain orchestrator-selected unless explicitly requested.
- **Runtime Truth Snapshots**: Runtime registry snapshots now persist `bootstrapCalled`, `orchestrateCalled`, `plannerCalled`, `tokenOptimizationApplied`, `skipReasons`, `lastToolCalls`, `sequenceCompliance`, and `clientInstructionStatus`.
- **Setup and Status UX**: `nexus-prime setup status` now reports installation and drift state for supported clients, while generated bootstrap artifacts stay compact and task-sequence oriented instead of dumping full catalogs.
- **Public Positioning**: README and docs now present Nexus Prime as an orchestrator-first MCP control plane with bootstrap-orchestrate defaults, runtime truth, token telemetry, and verified client setup paths.

### Fixed
- **Autonomous MCP Steering**: External clients are now guided toward the right first tool and no longer have to infer the correct sequence from a large undifferentiated tool list.
- **Antigravity File-Limit Failures**: Generated Antigravity/OpenClaw bootstrap instructions now split into compact `SKILL.md` chunks when needed, avoiding oversized single-file prompts.
- **Public Docs Drift**: Removed stale claims like the old fixed tool count and outdated setup wording, fixed the `NUXUS_PRIME_MCP` typo, added a working mobile-nav fallback, and aligned knowledge-base copy to human operators.
- **Public Exposure Risk**: The repo now guards against accidental publication of secret-like strings, local home-directory paths, and other obvious public-surface leaks in tested docs and release artifacts.

</details>

<details>
<summary><b>v3.9.0</b> · 2026-03-12 · Instruction gateway and execution ledger truth</summary>

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

</details>

<details>
<summary><b>v3.8.0</b> · 2026-03-11 · Orchestrator-first control plane</summary>

### Added
- **Autonomy Orchestrator**: Added an orchestrator-first control plane that classifies raw prompts, loads memory/session context, decomposes work, selects crews, specialists, skills, workflows, hooks, automations, and prepares the runtime package before execution.
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

</details>

<details>
<summary><b>v3.7.0</b> · 2026-03-11 · Shared runtime registry and worker handoff</summary>

### Added
- **Shared Runtime Registry**: Added a filesystem-backed per-runtime snapshot registry so active Nexus runtimes can publish their own usage truth across process boundaries.
- **Runtime Usage APIs**: Added dashboard-facing `/api/runtimes` and `/api/usage` surfaces for per-runtime visibility into memories, skills, roster, crews, planning, workflows, hooks, automations, governance, and federation.
- **Worker Context Packets**: Added canonical worker context payloads plus `context.json` and `context.md` artifacts under worker outputs and `.agent/runtime/` worktrees.
- **Local Override Conventions**: Added project-local `.agent/hooks` and `.agent/automations` directories plus a convention note for runtime handoff context.

### Changed
- **Runtime Consumption**: Active skills, workflows, specialist profile excerpts, review gates, and hook-added phase context now flow into worker manifests and deterministic execution instead of remaining mostly metadata.
- **Dashboard Truth Model**: The shared dashboard can now reuse a host process without conflating that host's in-memory state with another runtime's activity, and the UI exposes runtime selection with explicit used, stale, and not-used states.
- **Automation Lifecycle**: Queued automation follow-up runs now execute through a bounded continuation path with parent/source tracking and loop suppression.
- **Federation Status Surface**: Federation snapshots now include explicit relay configuration and degradation details instead of implying that NexusNet relay operations are live.
- **Agent Protocol Docs**: Updated AGENTS guidance to reflect planner surfaces, enforced two-coder minimums, and `.agent/runtime` worker context handoff.

### Fixed
- **Hook Propagation Gaps**: `before-mutate` and `before-verify` hook outputs now patch live manifests, actions, verify commands, and context artifacts instead of being recorded without effect.
- **Memory Dispatch Truthfulness**: Nexus-owned memory stores now route through runtime dispatch so `memory.stored` hooks and automations fire exactly once.
- **POD Minimum Enforcement**: Runtime worker selection now clamps coder counts to a minimum of two, matching the documented protocol.
- **Shared Dashboard Misreporting**: Reused dashboard hosts no longer make a newer runtime look idle just because the host process did not own that activity.

</details>

<details>
<summary><b>v3.6.0</b> · 2026-03-11 · Planner overlay and specialist roster</summary>

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

</details>

<details>
<summary><b>v3.5.0</b> · 2026-03-11 · Hooks, automations, shield, and federation truth</summary>

### Added
- **Expanded Living Product Brain**: Added broader bundled skill/workflow coverage for PDLC, GTM, writing, deep-tech, API, data, Python, Django, TypeScript, Node, React, AI, security, economics, plus builder/operator and approval-loop artifact families.
- **Hook Runtime**: Added first-class hook artifacts with checkpoint and event triggers for `run.created`, `before-read`, `before-mutate`, `before-verify`, `retry`, `run.failed`, `run.verified`, `promotion.approved`, `memory.stored`, and `shield.blocked`.
- **Automation Runtime**: Added first-class automation artifacts for event-driven, scheduled, and connector-bound workflows, including bounded follow-up execution and connector delivery records.
- **Security Shield**: Added a final shield layer for patch apply, promotion, connector delivery, and memory governance decisions with `allow`, `warn`, `quarantine`, and `block` outcomes.
- **Memory Audit Surfaces**: Added structured memory checks, audit reports, duplicate and contradiction detection, quarantine listing, and promotion-safety signals.
- **Federation State Model**: Replaced the mock federation surface with a real local-federation snapshot containing peer inventory, heartbeat aging, relay learnings, and published traces.
- **New MCP / CLI / Dashboard APIs**: Added hook, automation, memory-audit, and federation control and read surfaces across runtime APIs.

### Changed
- **Runtime Ledger**: Execution runs now record active hooks, active automations, shield decisions, memory checks, and federation state alongside skills, workflows, verifier evidence, and promotions.
- **Runtime Lifecycle**: Hook dispatch, automation dispatch, memory checks, and shield evaluation now participate directly in the real execution path instead of being external concepts.
- **Dashboard APIs**: Added `/api/hooks`, `/api/automations`, `/api/memory/audit`, `/api/memory/quarantine`, and `/api/federation`, plus deploy and run routes for hooks and automations.
- **CLI Execution Inputs**: `nexus-prime execute` now accepts hook selectors, automation selectors, shield policy, and memory policy.

### Fixed
- **Release Metadata Drift**: Synchronized the package lockfile version with the package version at `3.5.0`.
- **Federation Truthfulness**: Removed the fake gist-style publish IDs from the federation engine and replaced them with local-federation state and auditable trace handling.
- **Memory Safety Gates**: High-risk secret-bearing memories and unsupported claim patterns are now flagged before promotion-oriented use.

</details>

<details>
<summary><b>v3.2.2</b> · 2026-03-09 · Dashboard compatibility contract</summary>

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

</details>

<details>
<summary><b>v3.2.1</b> · 2026-03-09 · Topology-first dashboard restore</summary>

### Added
- **Topology-First Dashboard APIs**: Added `/api/memory`, `/api/memory/:id`, `/api/memory/:id/network`, `/api/pod`, `/api/pod/:workerId`, `/api/clients`, and `/api/events` to back the restored dashboard with real runtime data.
- **Client Registry**: Added a heartbeat-first, heuristic-second client registry that surfaces Codex, Claude Code, Antigravity, Opencode, and MCP presence with truthful status aging.
- **Dashboard Control Plane**: Added safe local dashboard `POST` routes for runtime execution plus skill, workflow, and client actions.

### Changed
- **Dashboard UX**: Replaced the card-heavy runtime console with the earlier topology-first layout: ecosystem rail, center graph canvas, live stream rail, and a persistent inspector drawer.
- **Runtime Resilience**: Dashboard run listings now fall back to persisted run artifacts so recent executions survive refresh and process boundaries.
- **Memory Surface**: Memory snapshots now expose lineage, linked memories, artifact-derived references, and network DTOs for interactive inspection.

### Fixed
- **POD Visibility**: Promoted POD signals to typed event-bus events and added worker, tag, and confidence summaries for the dashboard.
- **Dashboard Smoke Coverage**: Expanded integration coverage to verify the restored shell, graph data APIs, client visibility, and guarded control-plane actions.

</details>

<details>
<summary><b>v3.2.0</b> · 2026-03-09 · Workflow runtime and bundled domain packs</summary>

### Added
- **Bundled Domain Packs**: Added built-in skill and workflow packs for marketing, product, backend, frontend, sales, finance, workflows, and orchestration, with project-local `.agent` overrides.
- **Workflow Runtime**: Added first-class workflow artifacts, deployment state, derivation hooks, runtime application, and MCP workflow control surfaces.
- **Backend Registry**: Added selectable runtime backend registry for temporal and hyperbolic memory, meta-compression, deterministic NXL compilation, and experimental AgentLang and neural compilation.
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
- **Memory Backend Extensibility**: Added `MemoryEngine.snapshot()` so promoted temporal and hyperbolic ranking can operate on real persisted memories.

</details>

<details>
<summary><b>v3.1.0</b> · 2026-03-09 · Real runtime execution kernel</summary>

### Added
- **Real Sub-Agent Runtime**: Added a shared worktree-backed execution kernel that powers single-agent execution, swarms, MCP runtime calls, and NXL runs with artifact trails, verifier workers, rollback, and merge decisions.
- **Runtime Skill Fabric**: Added live runtime skill artifacts, guarded hot deployment, deployment tracking, and promotion and revocation hooks for read, orchestrate, and mutate skill classes.
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
- **Configurable State Paths**: Memory DB and POD message storage can now be redirected for sandboxed and headless environments, with tmp fallbacks where needed.
- **Headless Dashboard Startup**: Dashboard startup can now be disabled explicitly for CI and runtime tests.

</details>

<details>
<summary><b>v1.4.0</b> · 2026-03-06 · Multi-client setup and ecosystem dashboard</summary>

### Added
- **Multi-Tool MCP Integration**: Added support for Cursor, Claude Code, Opencode, Kilocode, and Codex.
- **`nexus-prime setup` CLI**: Added automated configuration for popular AI coding environments.
- **Ecosystem Dashboard**: Added the Connected Ecosystem panel to visualize integration status.
- **Refined MCP Adapter**: Enhanced tool metadata and descriptions for better discovery.

### Changed
- **Documentation**: Added a new `INTEGRATIONS.md` guide with step-by-step instructions and updated the README with supported clients and automated setup guidance.

### Fixed
- No user-facing fixes were recorded for this release.

</details>

<details>
<summary><b>v1.3.0</b> · 2026-03-05 · Deep-tech documentation wave</summary>

### Added
- **Documentation Overhaul**: Completely rewrote `README.md` and `docs/index.html` with a granular, system-level presentation focused on information architecture, memory topology, and swarm topology.
- **Five Pillars of Agent Intelligence**: Promoted the Entanglement Engine (Phase 9A) as a top-level feature and documented quantum-state style coordination.
- **Merge Oracle**: Documented the Oracle's use of Byzantine consensus, Pearson correlation, and AST-level hierarchical synthesis.
- **Advanced CLI UX Visualizations**: Added `nexus_decompose_task` and `nexus_assemble_context` so MCP output could render structured ASCII trees in the CLI.
- **Executive HITL Checkpoints**: Implemented `nexus_request_affirmation` for blocking dangerous operations behind explicit human approval in chat.
- **Auto-Gist Syncing**: `nexus_store_memory` now automatically relays high-priority findings to a GitHub Gist vault.

### Changed
- No separate changed section was recorded for this release.

### Fixed
- No user-facing fixes were recorded for this release.

</details>

<details>
<summary><b>v1.2.0</b> · 2026-03-04 · Documentation consolidation and runtime truth fixes</summary>

### Added
- **Premium Documentation**: Consolidated all `.md` files into a single, comprehensive `README.md` with a PM-agent lens and GitHub alerts.
- **Matrix-Style Dashboard**: Upgraded MCP telemetry output to a structured matrix format.
- **Cross-Process EventBus**: Added live dashboard metrics from MCP instances via file-polling telemetry bridging.
- **Robust Consensus Engine**: Replaced random stubs with task-aware Jaccard similarity voting, true gossip convergence, and G-Counter CRDTs.
- **Code-Aware CAS Tokenizer**: Attention Stream now tokenizes by camel case, punctuation, and whitespace for stronger compression gains.
- **Darwin Loop Validation**: Added pre-flight build validation before evolved hypotheses can be applied.

### Changed
- No separate changed section was recorded for this release.

### Fixed
- **Dashboard Empty State**: Addressed the architecture split by streaming events directly.
- **Memory Safety**: Wrapped `MemoryEngine.flush()` in a transaction with deep JSON sanitization, preventing `RangeError` panics on MCP shutdown.
- **NPM Provenance Failing**: Normalized `package.json` bins and repositories using `npm pkg fix` to enable automated GitHub Actions CI.

</details>
