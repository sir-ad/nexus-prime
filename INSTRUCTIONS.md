# 🤖 Nexus Prime — Multi-Agent Instruction Set for Gemini Flash

> **Purpose**: Step-by-step playbook for a Gemini Flash agent to maintain, document, release, and deploy Nexus Prime.
> **Target Model**: Gemini Flash 2.0 (low-tier, token-constrained).
> **Design**: Each section is a self-contained "agent task" that can be run independently.
> **Rule**: Follow each step EXACTLY. Do NOT skip steps. Do NOT improvise beyond what is written.

---

## Table of Contents

1. [Agent 1: Git Commit & Push](#agent-1-git-commit--push)
2. [Agent 2: GitHub Release](#agent-2-github-release)
3. [Agent 3: NPM Publish](#agent-3-npm-publish)
4. [Agent 4: README Rewrite](#agent-4-readme-rewrite-world-class-open-source)
5. [Agent 5: Architecture Docs Update](#agent-5-architecture-docs-update)
6. [Agent 6: Website & Link Audit](#agent-6-website--link-audit)
7. [Agent 7: AGENTS.md & GEMINI.md Sync](#agent-7-agentsmd--geminimd-sync)
8. [Constants & References](#constants--references)

---

## Constants & References

```yaml
OWNER: sir-ad
REPO: nexus-prime
REPO_URL: https://github.com/sir-ad/nexus-prime
NPM_PACKAGE: nexus-prime
LICENSE: MIT
NODE_MIN: ">=18.0.0"
BRANCH: main
LOCAL_PATH: /Users/starlord/nexus-prime
BUILD_CMD: npm run build
TEST_CMD: npm run test
LINT_CMD: npm run lint
```

### Engine Files (29 total in `src/engines/`)

```
attention-stream.ts    benchmark.ts           byzantine-consensus.ts
cache-manager.ts       context-assembler.ts   context.ts
darwin-journal.ts      darwin-loop.ts         embedder.ts
entanglement.ts        entity-extractor.ts    event-bus.ts
graph-memory.ts        graph-traversal.ts     guardrails-bridge.ts
hilbert-space.ts       hybrid-retriever.ts    index.ts
kv-bridge.ts           memory.ts              meta-learner.ts
nexusnet-relay.ts      orchestrator.ts        pattern-codebook.ts
pod-network.ts         session-dna.ts         skill-card.ts
token-optimizer.ts     token-supremacy.ts
```

### Ecosystem Links (verified repos)

| Project | Repo URL | Status |
|---------|----------|--------|
| Nexus Prime | `https://github.com/sir-ad/nexus-prime` | Active |
| MindKit | `https://github.com/sir-ad/mindkit` | Active |
| Phantom | `https://github.com/sir-ad/phantom` | Active |
| Grain | `https://github.com/sir-ad/grain` | Active |

### MCP Tools (12 total, current)

| Tool | Phase |
|------|-------|
| `nexus_recall_memory` | Core |
| `nexus_store_memory` | Core |
| `nexus_memory_stats` | Core |
| `nexus_optimize_tokens` | Core |
| `nexus_ghost_pass` | Core |
| `nexus_mindkit_check` | Core |
| `nexus_spawn_workers` | Core |
| `nexus_audit_evolution` | Core |
| `nexus_entangle` | Phase 9A |
| `nexus_cas_compress` | Phase 9B |
| `nexus_kv_bridge_status` | Phase 9C |
| `nexus_kv_adapt` | Phase 9C |

---

## Agent 1: Git Commit & Push

**Goal**: Stage all changes, commit with a conventional commit message, push to `main`.

### Pre-flight Checks

```bash
cd /Users/starlord/nexus-prime
npm run build      # MUST pass with 0 errors
npm run test       # MUST pass all tests
npm run lint       # MUST have 0 errors (warnings OK)
```

> ⛔ If ANY of the above fails, FIX the error FIRST. Do NOT commit broken code.

### Commit Rules

1. **Conventional Commits** format: `type(scope): description`
2. Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`
3. Scope = affected area: `memory`, `phantom`, `mcp`, `engines`, `docs`, `readme`

### Steps

```bash
# 1. Check what changed
git status
git diff --stat

# 2. Stage all changes
git add .

# 3. Commit with conventional message
git commit -m "type(scope): description of what changed"

# 4. Push to main
git push origin main
```

### Examples

```bash
git commit -m "feat(engines): add Phase 9 quantum entanglement engine"
git commit -m "docs(readme): rewrite README with badges and architecture"
git commit -m "fix(mcp): correct CAS encode arguments in adapter"
```

---

## Agent 2: GitHub Release

**Goal**: Create a GitHub release with tag, changelog, and assets.

### Version Bump Rules

| Change Type | Bump | Example |
|------------|------|---------|
| Breaking API change | MAJOR | 0.2.0 → 1.0.0 |
| New feature (backward compatible) | MINOR | 0.2.0 → 0.3.0 |
| Bug fix only | PATCH | 0.2.0 → 0.2.1 |

### Steps

```bash
# 1. Decide new version (check current in package.json)
cat package.json | grep '"version"'
# Current: "0.2.0"

# 2. Update version in package.json
# Edit "version": "0.X.Y" to new version

# 3. Build and test
npm run build && npm run test

# 4. Commit the version bump
git add package.json
git commit -m "chore(release): bump version to 0.X.Y"

# 5. Create git tag
git tag -a v0.X.Y -m "Release v0.X.Y"

# 6. Push with tags
git push origin main --tags
```

### Changelog Template

Write the release body using this template:

```markdown
## What's New in v0.X.Y

### ✨ Features
- Feature 1 description
- Feature 2 description

### 🐛 Bug Fixes
- Fix 1 description

### 📦 Engine Count
- **29 engines** in `src/engines/`
- **12 MCP tools** exposed
- **21+ tests** passing

### 🛠️ Technical
- Node.js >= 18.0.0
- TypeScript 5.3+
- SQLite-backed memory persistence

### Full Changelog
https://github.com/sir-ad/nexus-prime/compare/vPREVIOUS...v0.X.Y
```

### Create Release via GitHub MCP

Use the GitHub MCP `create_or_update_file` tool or the GitHub web UI to create the release from the tag.

---

## Agent 3: NPM Publish

**Goal**: Publish the package to npm.

### Pre-requisites

- `NPM_TOKEN` secret must be set in GitHub repo settings under Environment `NPM_TOKEN`
- OR: local `npm login` must be done

### Steps (Local)

```bash
# 1. Ensure clean build
npm run build

# 2. Dry run first (safe)
npm publish --dry-run

# 3. If dry run looks good, publish
npm publish --access public
```

### Steps (CI — Automatic)

The CI workflow `.github/workflows/ci-publish.yml` handles this automatically:
- Triggers on: `release` event (type: `published`)
- Runs: `npm ci` → `npm run build` → `npm publish --access public --provenance`
- Requires: `NPM_TOKEN` secret in the `NPM_TOKEN` environment

> So just create a GitHub Release (Agent 2) and CI will handle npm publish.

---

## Agent 4: README Rewrite (World-Class Open Source)

**Goal**: Rewrite `README.md` to be a world-class open source README.

### File: `README.md` (root of repo)

### Required Sections (in this exact order)

```markdown
# 🧬 Nexus Prime

> One-line tagline goes here.

<!-- Badges row - ALL of these must be included -->
[![npm version](https://img.shields.io/npm/v/nexus-prime?style=flat-square&color=cb3837)](https://www.npmjs.com/package/nexus-prime)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Build Status](https://img.shields.io/github/actions/workflow/status/sir-ad/nexus-prime/ci-publish.yml?branch=main&style=flat-square)](https://github.com/sir-ad/nexus-prime/actions)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-43853d?style=flat-square&logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178c6?style=flat-square&logo=typescript)](https://typescriptlang.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/sir-ad/nexus-prime/pulls)
[![GitHub stars](https://img.shields.io/github/stars/sir-ad/nexus-prime?style=flat-square)](https://github.com/sir-ad/nexus-prime/stargazers)
[![npm downloads](https://img.shields.io/npm/dm/nexus-prime?style=flat-square)](https://www.npmjs.com/package/nexus-prime)
```

### Section Checklist

Each section below MUST appear in the README. Use the heading text exactly.

1. **Badges** — see above (npm, license, CI, Node, TS, PRs, stars, downloads)
2. **One-paragraph description** — what it does, who it's for, why it matters
3. **"The Super Intellect Stack"** — the 4-project ecosystem diagram (Phantom → MindKit → Nexus Prime → Grain)
4. **"Why Nexus Prime?"** — bullet list of 5 key value propositions
5. **"Quick Start"** — install + MCP config (copy-paste ready, 3 steps max)
6. **"Architecture"** — Mermaid flowchart showing all 29 engines grouped by subsystem. MUST include Phase 9 engines: Entanglement, CAS, KV Bridge, Byzantine Consensus
7. **"The 12 MCP Tools"** — table with Tool name, When to use, What it does. Group into: Memory (3), Intelligence (3), Parallel Work (2), Phase 9 (4)
8. **"Memory System"** — 3-tier table (Prefrontal/Hippocampus/Cortex)
9. **"Phantom Workers"** — diagram showing GhostPass → Workers → POD → MergeOracle
10. **"Phase 9: Innovation Vectors"** — brief section on Quantum Entanglement, CAS, KV Bridge
11. **"Project Structure"** — tree showing ALL current directories and key files. MUST include all 29 engine files
12. **"Configuration"** — env vars table. Include NexusNet vars: `GITHUB_TOKEN`, `NEXUSNET_GIST_ID`
13. **"Contributing"** — standard open source contributing guidelines
14. **"Ecosystem"** — links to all 4 repos with descriptions
15. **"License"** — MIT with link to author

### Architecture Mermaid Diagram (MUST include these subsystems)

```
Core Engines:
  - MemoryEngine (3-tier: Prefrontal → Hippocampus → Cortex)
  - TokenSupremacyEngine (scoring, budget allocation, CAS integration)
  - GuardrailEngine (MindKit sync)
  - EmbedderEngine (TF-IDF + API fallback)
  - HyperTuning Engine
  - MetaLearner
  - CacheManager
  - ContextAssembler
  - EventBus

Phantom Swarm:
  - GhostPass
  - PhantomWorker (with Entanglement integration)
  - POD Network
  - MergeOracle

Phase 8 Engines:
  - SessionDNA
  - SkillCard
  - DarwinLoop + DarwinJournal
  - GraphMemory + GraphTraversal + EntityExtractor + HybridRetriever
  - NexusNet Relay
  - Benchmark Suite

Phase 9 Engines:
  - EntanglementEngine + HilbertSpace
  - ContinuousAttentionStream + PatternCodebook
  - KVBridge + ByzantineConsensus
```

### Writing Style Rules

- Use emoji sparingly (max 1 per section heading)
- Short sentences. No walls of text.
- Every code block must be copy-paste ready.
- Tables over paragraphs when listing features.
- Mermaid diagrams over ASCII art.

### Project Structure Tree (use this exact format)

```
nexus-prime/
├── src/
│   ├── index.ts                    # NexusPrime main class
│   ├── cli.ts                      # CLI entry point
│   ├── agents/
│   │   ├── adapters/mcp.ts         # MCP server (12 tools)
│   │   ├── coordinator.ts          # Worker dispatch
│   │   ├── orchestrator.ts         # Context-aware agent runner
│   │   └── learner.ts              # Evolution detection
│   ├── engines/                    # 29 engine files
│   │   ├── memory.ts               # 3-tier memory system
│   │   ├── token-supremacy.ts      # Token optimization + CAS
│   │   ├── guardrails-bridge.ts    # MindKit guardrails
│   │   ├── embedder.ts             # TF-IDF embeddings
│   │   ├── meta-learner.ts         # MAML adaptation
│   │   ├── cache-manager.ts        # Agent delta caching
│   │   ├── context-assembler.ts    # File chunking
│   │   ├── event-bus.ts            # Cross-engine events
│   │   ├── session-dna.ts          # Session handover
│   │   ├── skill-card.ts           # Transferable patterns
│   │   ├── darwin-loop.ts          # Self-evolution
│   │   ├── graph-memory.ts         # Knowledge graphs
│   │   ├── nexusnet-relay.ts       # Cross-machine federation
│   │   ├── entanglement.ts         # Quantum-inspired (Phase 9A)
│   │   ├── hilbert-space.ts        # Hilbert math primitives
│   │   ├── attention-stream.ts     # Continuous Attention (Phase 9B)
│   │   ├── pattern-codebook.ts     # Compression codebook
│   │   ├── kv-bridge.ts            # vLLM/Ollama bridge (Phase 9C)
│   │   ├── byzantine-consensus.ts  # PBFT consensus
│   │   └── ...                     # + 10 more support engines
│   ├── phantom/
│   │   ├── index.ts                # GhostPass + PhantomWorker
│   │   └── merge-oracle.ts         # Byzantine merge voting
│   └── dashboard/
│       └── index.html              # Real-time visualization
├── test/                           # Test suites
├── docs/                           # Website HTML
│   ├── index.html                  # Main documentation site
│   └── knowledge-base.html         # Knowledge base page
├── packages/mindkit/               # Standalone MindKit package
├── .github/workflows/
│   ├── ci-publish.yml              # Build + NPM publish
│   └── test-engines.yml            # Engine test runner
├── GEMINI.md                       # AI agent session protocol
├── AGENTS.md                       # Agent quick reference
├── NEXUS.md                        # Language specification
└── package.json                    # v0.2.0
```

---

## Agent 5: Architecture Docs Update

**Goal**: Update architecture documentation to reflect all 29 engines and Phase 9.

### Files to Update

1. `README.md` — Architecture section (see Agent 4)
2. `AGENTS.md` — Tool count (currently says 6, should say 12)
3. `GEMINI.md` — Tool count (currently says 8, add Phase 9 tools)
4. `NEXUS.md` — Review and update if needed

### AGENTS.md Fixes

Find and replace:

```diff
- ## 🔧 Available MCP Tools (6)
+ ## 🔧 Available MCP Tools (12)
```

Add these rows to the tool table:

```markdown
| `nexus_spawn_workers` | Parallel git worktree sub-agents |
| `nexus_audit_evolution` | Find recurring failure patterns |
| `nexus_entangle` | Quantum-inspired agent correlation |
| `nexus_cas_compress` | Continuous attention compression |
| `nexus_kv_bridge_status` | KV cache bridge metrics |
| `nexus_kv_adapt` | Adapt KV bridge to new tasks |
```

### GEMINI.md Fixes

Add Phase 9 tools to the Tool Reference table:

```markdown
| `nexus_entangle` | **Quantum coordination** — measure entangled agent states |
| `nexus_cas_compress` | **Token compression** — continuous attention stream encoding |
| `nexus_kv_bridge_status` | **KV monitoring** — bridge metrics and consensus status |
| `nexus_kv_adapt` | **KV adaptation** — adapt bridge to new task types |
```

Change the tool count from 8 to 12:

```diff
- Nexus Prime exposes **8 tools** via MCP.
+ Nexus Prime exposes **12 tools** via MCP.
```

---

## Agent 6: Website & Link Audit

**Goal**: Audit and fix all links in docs, README, and website HTML files.

### Files to Audit

| File | Path |
|------|------|
| README.md | `/Users/starlord/nexus-prime/README.md` |
| docs/index.html | `/Users/starlord/nexus-prime/docs/index.html` |
| docs/knowledge-base.html | `/Users/starlord/nexus-prime/docs/knowledge-base.html` |
| AGENTS.md | `/Users/starlord/nexus-prime/AGENTS.md` |
| GEMINI.md | `/Users/starlord/nexus-prime/GEMINI.md` |

### Link Validation Rules

1. **GitHub repo links** must point to `https://github.com/sir-ad/REPO_NAME`
2. **NPM links** must point to `https://www.npmjs.com/package/nexus-prime`
3. **Internal links** (anchors) must match actual heading IDs
4. **Ecosystem links** — verify all 4 repos exist:
   - `https://github.com/sir-ad/nexus-prime` ✅
   - `https://github.com/sir-ad/mindkit` — verify exists
   - `https://github.com/sir-ad/phantom` — verify exists
   - `https://github.com/sir-ad/grain` — verify exists
5. **Badge URLs** must use correct owner/repo: `sir-ad/nexus-prime`

### Steps

```bash
# 1. Extract all URLs from markdown files
grep -rn 'http' README.md AGENTS.md GEMINI.md NEXUS.md

# 2. Extract all URLs from HTML files
grep -rn 'href=' docs/index.html docs/knowledge-base.html

# 3. For each URL, verify it does not 404
# Test critical links manually:
curl -sL -o /dev/null -w "%{http_code}" https://github.com/sir-ad/nexus-prime
curl -sL -o /dev/null -w "%{http_code}" https://github.com/sir-ad/mindkit
curl -sL -o /dev/null -w "%{http_code}" https://github.com/sir-ad/phantom
curl -sL -o /dev/null -w "%{http_code}" https://github.com/sir-ad/grain
curl -sL -o /dev/null -w "%{http_code}" https://www.npmjs.com/package/nexus-prime

# 4. Fix any broken links found
# Replace 404 URLs with correct URLs or remove dead links
```

### Common Fix Patterns

| Broken Pattern | Fix |
|---------------|-----|
| `github.com/sir-ad/phantom` (404) | Remove or add `(coming soon)` note |
| `github.com/sir-ad/grain` (404) | Remove or add `(coming soon)` note |
| Missing `#anchor` links | Regenerate from actual headings |
| Old npm badge URL | Use `https://img.shields.io/npm/v/nexus-prime` |
| Broken relative links in HTML | Use absolute GitHub raw URLs |

### docs/index.html Rules

1. All navigation links must point to valid anchors or pages
2. Links to GitHub must use `https://github.com/sir-ad/nexus-prime`
3. "Get Started" buttons must link to `#quick-start` or valid section
4. External links must open in `target="_blank"`
5. Remove any links to non-existent pages

---

## Agent 7: AGENTS.md & GEMINI.md Sync

**Goal**: Ensure protocol docs match current codebase state.

### AGENTS.md Checklist

- [ ] Tool count matches actual (`12`, not `6`)
- [ ] All 12 tools listed in the table
- [ ] Session start protocol includes `nexus_recall_memory` + `nexus_memory_stats`
- [ ] Links to GitHub repos are correct
- [ ] No references to removed features

### GEMINI.md Checklist

- [ ] Tool count matches actual (`12`, not `8`)
- [ ] All 12 tools listed in the Tool Reference table
- [ ] `nexus_session_dna` tool is listed (currently in table but may not exist yet)
- [ ] MCP server command: `node /path/to/nexus-prime/dist/cli.js mcp`
- [ ] Memory path: `~/.nexus-prime/memory.db`
- [ ] Tag taxonomy is complete
- [ ] Anti-patterns section is current

---

## Orchestration Order

When running all agents, execute in this order:

```
1. Agent 6: Website & Link Audit    (audit first, understand what's broken)
2. Agent 5: Architecture Docs       (update AGENTS.md, GEMINI.md tool counts)
3. Agent 4: README Rewrite          (the big README rewrite)
4. Agent 7: Protocol Sync           (final sync pass)
5. Agent 1: Git Commit & Push       (commit everything)
6. Agent 2: GitHub Release          (tag and release)
7. Agent 3: NPM Publish             (automatic via CI, or manual)
```

### Dependency Graph

```
Agent 6 (audit) ──→ Agent 5 (arch) ──→ Agent 4 (readme) ──→ Agent 7 (sync)
                                                                    │
                                                                    ▼
                                                        Agent 1 (commit) ──→ Agent 2 (release) ──→ Agent 3 (npm)
```

---

## Quick Command Reference

```bash
# Build
npm run build

# Test
npm run test

# Lint
npm run lint

# Full pre-commit check
npm run build && npm run test && npm run lint

# Git commit + push
git add . && git commit -m "type(scope): message" && git push origin main

# Tag release
git tag -a v0.X.Y -m "Release v0.X.Y" && git push origin main --tags

# NPM publish (manual)
npm publish --access public

# Start MCP server (for testing)
node dist/cli.js mcp

# Run dashboard
node dist/cli.js start
```

---

## Error Recovery

| Error | Fix |
|-------|-----|
| `tsc` build fails | Check TypeScript errors, fix type mismatches |
| Test fails | Run failing test in isolation: `npx tsx test/FILE.test.ts` |
| `npm publish` 403 | Check `NPM_TOKEN` is set and has publish access |
| `git push` rejected | Pull first: `git pull --rebase origin main` |
| Dashboard won't load | Ensure `cp src/dashboard/index.html dist/dashboard/` ran during build |
| Memory DB locked | Kill other `nexus-prime` processes: `pkill -f "cli.js mcp"` |

---

*Generated: 2026-03-04 | Nexus Prime v0.2.0 | 29 engines, 12 MCP tools, 21+ tests*
