# Changelog

All notable changes to Nexus Prime will be documented in this file.

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
