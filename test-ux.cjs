const { MCPAdapter } = require('./dist/agents/adapters/mcp.js');

async function run() {
    console.log("Initializing MCP Adapter with stub...");

    const adapter = new MCPAdapter();
    adapter.setNexusRef({
        memory: { getStats: () => ({ prefrontal: 1, hippocampus: 2, cortex: 3, totalLinks: 4, topTags: [] }) },
        storeMemory: () => 'mem-123',
        recallMemory: async () => [],
        getMemoryStats: () => ({ prefrontal: 1, hippocampus: 2, cortex: 3, totalLinks: 4, topTags: [] })
    });

    const handleToolCall = adapter['handleToolCall'].bind(adapter);

    console.log("=== nexus_decompose_task ===");
    await handleToolCall({
        params: {
            name: 'nexus_decompose_task',
            arguments: {
                goal: 'Improve CLI UX with premium matrix styling across all adapters',
                steps: [
                    'Implement ASCII tree rendering',
                    'Add validation for hitl boundaries',
                    'Test output under different terminal widths'
                ]
            }
        }
    });

    console.log("\n=== nexus_assemble_context ===");
    await handleToolCall({
        params: {
            name: 'nexus_assemble_context',
            arguments: {
                reason: 'Working on MCP adapter refactor',
                files: [
                    'src/agents/adapters/mcp.ts',
                    'src/engines/guardrail.ts',
                    'src/cli.ts'
                ]
            }
        }
    });

    console.log("\n=== nexus_request_affirmation (warning) ===");
    await handleToolCall({
        params: {
            name: 'nexus_request_affirmation',
            arguments: {
                message: 'The current context exceeds optimal limits, do you want to prune some files?',
                severity: 'warning'
            }
        }
    });

    console.log("\n=== nexus_request_affirmation (critical) ===");
    await handleToolCall({
        params: {
            name: 'nexus_request_affirmation',
            arguments: {
                message: 'You are about to flush the entire memory database to disk. This will overwrite previous states. Proceed?',
                severity: 'critical'
            }
        }
    });

}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
