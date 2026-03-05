# Changelog

All notable changes to Nexus Prime will be documented in this file.

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
