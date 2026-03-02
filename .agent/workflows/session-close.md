---
description: End-of-session memory flush — persist all learnings
---

# Session Close Workflow

Run this at the end of every agent session to persist context.

## Steps
1. Collect all findings produced during this session
2. Run `skills/infra/topic-indexer.md` — assign semantic markers to all findings
3. Run `skills/infra/context-manager.md` — write session report to `.mindkit/sessions/`
4. Run `skills/infra/memory-architect.md` — update topic files, check integrity
5. Verify `.mindkit/index.md` is updated
6. Sync to remote repository: `git add . && git commit -m "sync: session end" && git push`
