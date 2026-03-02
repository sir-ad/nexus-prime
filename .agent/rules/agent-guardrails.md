# Agent Guardrails

Strict constraints for all AI agents. Non-negotiable.

## Token Limits
| Skill Cost | Max Input | Max Output |
|---|---|---|
| S (small) | 2K tokens | 50 lines |
| M (medium) | 8K tokens | 100 lines |
| L (large) | 20K tokens | 200 lines |

## Safety Rails
- **Read-only by default.** Agents report, they don't modify unless explicitly allowed.
- **No installs.** Never run `npm install` or equivalent without user approval.
- **No network.** No external API calls unless declared in skill header.
- **No secrets.** Never output API keys, tokens, or `.env` contents.
- **No recursive loops.** A skill must never invoke itself.

## Output Format (Mandatory)
Every skill output must contain exactly:
```markdown
## Summary
[≤5 lines — what was done, top-level result]

## Findings
[Bulleted list with semantic markers — cite file:line]

## Actions
[Prioritized action items]
```

## Coordination Rules
- Only the orchestrator decides which skills run
- Skills declare dependencies in YAML frontmatter
- If a skill can't complete, return `## Summary: INCOMPLETE` with reason
- All findings tagged with semantic markers (`#bug`, `#debt`, `#risk`, etc.)

## Memory Rules
- Tag every finding with ≥1 semantic marker
- Flush session context at session end
- Check for existing context before re-reading files
- No duplicate memory entries
