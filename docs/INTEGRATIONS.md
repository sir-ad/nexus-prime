# Nexus Prime Integration Guide

This document provides detailed instructions for integrating Nexus Prime as an MCP (Model Context Protocol) server into various AI coding environments.

## Automated Setup

The easiest way to integrate is using the `nexus-prime setup` command:

```bash
# Globally install first
npm install -g nexus-prime

# Run setup for your tool
nexus-prime setup cursor
nexus-prime setup claude
nexus-prime setup opencode
```

## Supported Tools

### 🔵 Cursor
Cursor uses a global storage file for MCP server configurations.
- **Automated**: `nexus-prime setup cursor`
- **Manual Path**: `~/Library/Application Support/Cursor/User/globalStorage/mcpServers.json`

### 🍊 Claude Code
Claude Code looks for an `mcp.json` in its configuration directory.
- **Automated**: `nexus-prime setup claude`
- **Manual Path**: `~/.claude-code/mcp.json`

### 🟢 Opencode
Opencode uses a `config.json` with an `mcp` server list.
- **Automated**: `nexus-prime setup opencode`
- **Manual Path**: `~/.opencode/config.json`

### 🟣 Kilocode / 🔴 Codex
For tools that don't have a standardized configuration file yet, you can pass the following environment variables if they support manual MCP server induction:

```bash
NUXUS_PRIME_MCP=true
MCP_PORT=3377
```

## Verification

After integration, verify the connection from your tool:
1. Open the tool's AI or Settings pane.
2. Look for "nexus-prime-mcp" in the connected servers list.
3. Try calling `nexus_memory_stats` to confirm the bridge is active.

## Troubleshooting

- **Polluted Stdout**: Ensure you are using `npx -y nexus-prime mcp`. If you run it locally, any `console.log` from other modules might break the JSON-RPC stream. Nexus Prime redirects all logs to `stderr` in MCP mode to prevent this.
- **Version Mismatch**: Ensure `npx` is fetching the latest version (`v1.4.0+`).
