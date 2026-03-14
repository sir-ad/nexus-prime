# Nexus Prime Integration Guide

This document provides detailed instructions for integrating Nexus Prime as an MCP (Model Context Protocol) server into various AI coding environments.

Useful public references:
- Docs home: `https://sir-ad.github.io/nexus-prime/`
- Platform catalog: `https://sir-ad.github.io/nexus-prime/catalog.html`
- Architecture diagrams: `https://sir-ad.github.io/nexus-prime/architecture-diagrams.html`

## Automated Setup

The easiest way to integrate is using the `nexus-prime setup` command:

```bash
# Globally install first
npm install -g nexus-prime

# Run setup for your tool
nexus-prime setup codex
nexus-prime setup cursor
nexus-prime setup claude
nexus-prime setup opencode
nexus-prime setup windsurf
nexus-prime setup antigravity
nexus-prime setup all
```

Home-scoped bootstrap is also created automatically on install or first binary start, and the first Nexus run inside a repo writes the workspace-scoped client files it needs. Use `nexus-prime setup <client>` or `nexus-prime setup all` when you want to force-refresh them.

## Supported Tools

### 🔵 Cursor
Cursor uses an MCP config plus a project-local `.mdc` rule file.
- **Automated**: `nexus-prime setup cursor`
- **MCP Config**: `~/.cursor/mcp.json`
- **Project Rule**: `.cursor/rules/nexus-prime.mdc`

### 🍊 Claude Code
Claude Code uses an MCP config plus a generated project-local bootstrap note.
- **Automated**: `nexus-prime setup claude`
- **MCP Config**: `~/.claude-code/mcp.json`
- **Project Instruction**: `.agent/client-bootstrap/claude-code.md`

### 🟢 Opencode
Opencode uses a `config.json` with an `mcp` server list plus a generated project-local bootstrap note.
- **Automated**: `nexus-prime setup opencode`
- **MCP Config**: `~/.opencode/config.json`
- **Project Instruction**: `.agent/client-bootstrap/opencode.md`

### 🌊 Windsurf
- **Automated**: `nexus-prime setup windsurf`
- **MCP Config**: `~/.windsurf/mcp.json`
- **Project Rule**: `.windsurfrules`

### 🛡️ Antigravity / OpenClaw
- **Automated**: `nexus-prime setup antigravity`
- **MCP Config**: `~/.antigravity/mcp.json`
- **Home-Scoped Skill Bundle**: `~/.antigravity/skills/nexus-prime/`

### 🔴 Codex
Codex now has an automated setup path that creates or updates a managed Nexus Prime bootstrap block in the repo-local `AGENTS.md`.
- **Automated**: `nexus-prime setup codex`
- **Project Instruction**: `AGENTS.md` (managed Nexus Prime bootstrap block)

## Verification

After integration, verify the connection from your tool:
1. Open the tool's AI or Settings pane.
2. Look for "nexus-prime-mcp" in the connected servers list.
3. Call `nexus_session_bootstrap` to confirm the bridge and the default runtime path are active.
4. For non-trivial work, follow with `nexus_orchestrate` instead of chaining low-level tools by hand.

## Troubleshooting

- **Polluted Stdout**: Ensure you are using `npx -y nexus-prime mcp`. If you run it locally, any `console.log` from other modules might break the JSON-RPC stream. Nexus Prime redirects all logs to `stderr` in MCP mode to prevent this.
- **Wrong MCP Profile**: External clients should use `NEXUS_MCP_TOOL_PROFILE=autonomous`. The `setup` command writes this automatically.
- **Version Mismatch**: Ensure `npx` is fetching the latest current version.
