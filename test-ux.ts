import { MCPAdapter } from './src/agents/adapters/mcp';
import { NexusPrime } from './src/index';

async function run() {
    const nexus = new NexusPrime();
    await nexus.start();

    const adapter = new MCPAdapter();
    adapter.setNexusRef(nexus);

    const handleToolCall = adapter['handleToolCall'].bind(adapter);

    console.log("=== Testing nexus_decompose_task ===");
    const resDecompose = await handleToolCall({
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
    console.log("Response text:", resDecompose.content[0].text);

    console.log("\n=== Testing nexus_assemble_context ===");
    const resAssemble = await handleToolCall({
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
    console.log("Response text:", resAssemble.content[0].text);

    console.log("\n=== Testing nexus_request_affirmation (warning) ===");
    const resAffirmWarning = await handleToolCall({
        params: {
            name: 'nexus_request_affirmation',
            arguments: {
                message: 'The current context exceeds optimal limits, do you want to prune some files?',
                severity: 'warning'
            }
        }
    });
    console.log("Response text:", resAffirmWarning.content[0].text);

    console.log("\n=== Testing nexus_request_affirmation (critical) ===");
    const resAffirmCritical = await handleToolCall({
        params: {
            name: 'nexus_request_affirmation',
            arguments: {
                message: 'You are about to flush the entire memory database to disk. This will overwrite previous states. Proceed?',
                severity: 'critical'
            }
        }
    });
    console.log("Response text:", resAffirmCritical.content[0].text);

}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
