---
description: Pre-deployment review — verify everything is ready to ship
---

# Deploy Prep Workflow

Run this before deploying or publishing a release.

## Steps
1. Load context from `.mindkit/`
2. `skills/technical/devops-auditor.md` — full pipeline check
3. `skills/technical/qa-testing-agent.md` — full test suite + coverage
4. `skills/technical/frontend-auditor.md` — build succeeds, no broken routes
5. `skills/business/pm-agent.md` — release readiness checklist
6. Synthesize: go/no-go decision with blocker list
7. Flush session
