# Release Process

Use this checklist for any Nexus Prime release that changes runtime behavior, MCP surfaces, dashboard truth, or public docs.

## 1. Freeze the release candidate
- Branch from the current release surface using `ad/release-vNEXT-qa`
- Keep unrelated local artifacts out of scope
- Do not tag or publish from an unreviewed `main`

## 2. Run the local gate
Run in this order:

```bash
npm run build
npm run lint
npm test
npm pack --dry-run
npm run audit:prod
npm run smoke:release
```

Hard blockers:
- Build failure
- Test failure
- Public-surface scan failure
- Package dry-run failure
- Production dependency audit failure
- Release smoke failure

Lint policy:
- Zero lint errors repo-wide
- Zero lint warnings in changed files
- Legacy warnings outside the release surface must be explicitly deferred

## 3. Run product smoke checks
- Confirm MCP autonomous profile shows `nexus_session_bootstrap` and `nexus_orchestrate` first
- Confirm a non-trivial orchestrated run records planner, token, and sequence fields
- Confirm worktree health is recorded and stale Nexus-owned worktree metadata self-heals before execution
- Confirm the dashboard renders persisted runtime truth and token/provenance data
- Confirm docs landing page, catalog page, integrations page, and knowledge base load correctly

## 4. Review before merge
- Use the PR template checklist
- Resolve blockers or record them as explicit follow-up items
- Require at least one peer review before merging

## 5. Remote deploy sequence
1. Open a PR from the release branch into `main`
2. Wait for `Test Engines` and `CI & Publish` to pass
3. Merge to `main`
4. Verify GitHub Pages deployment
5. Create the GitHub release and tag
6. Verify npm publish completes
7. Smoke-test installation with `npx nexus-prime mcp`

## 6. Post-release checks
- GitHub release notes match README and changelog
- Published npm version is live
- Docs/Pages are healthy
- No local-only artifacts or secret-like strings leaked into public surfaces
