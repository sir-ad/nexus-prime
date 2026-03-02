---
description: Run all agents end-to-end for a comprehensive project audit
---

# Full Audit Workflow

Run this when you need a complete assessment of the project from every angle.

## Pre-flight
1. Read `skills/foundation/token-guardian.md` — internalize token rules
2. Read `skills/infra/skill-registry.md` — discover available skills
3. Load context from `.mindkit/` (via context-manager protocol)

## Phase 1: Technical Sweep (Parallel)
Run these simultaneously — they have no dependencies on each other:
- `skills/technical/frontend-auditor.md`
- `skills/technical/backend-inspector.md`
- `skills/technical/cli-node-reviewer.md`

## Phase 2: Quality & Ops (Parallel)
- `skills/technical/devops-auditor.md`
- `skills/technical/qa-testing-agent.md`

## Phase 3: Deep Review (Sequential)
Uses flagged files from Phases 1-2:
- `skills/technical/code-review-agent.md` — focus on problem areas identified above

## Phase 4: Business View (Parallel)
- `skills/business/business-analyst.md`
- `skills/business/tech-lead.md`
- `skills/business/ai-lead.md`

## Phase 5: Product & UX (Parallel)
- `skills/business/pm-agent.md`
- `skills/business/ux-researcher.md`

## Phase 6: Executive Summary (Sequential)
Uses all prior outputs:
- `skills/business/cto-ceo-strategy.md`

## Post-flight
1. Run `skills/infra/topic-indexer.md` — tag all findings
2. Run `skills/infra/context-manager.md` — flush session
3. Produce a combined report following orchestrator format
