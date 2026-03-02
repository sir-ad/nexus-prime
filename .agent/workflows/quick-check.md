---
description: Fast health check — build, tests, and critical issues only
---

# Quick Check Workflow

Run this for a fast pulse on project health. Under 5 minutes.

## Steps
1. Load context from `.mindkit/` if available
2. Run `skills/technical/qa-testing-agent.md` — tests pass/fail only (skip coverage)
3. Run `skills/technical/devops-auditor.md` — build status only (skip full analysis)
4. Synthesize: does it build? Do tests pass? Any blockers?
5. Flush session via context-manager
