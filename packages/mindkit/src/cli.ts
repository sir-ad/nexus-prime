#!/usr/bin/env node
/**
 * Mindkit CLI
 *
 * mindkit init     — scaffold .agent/ into current project
 * mindkit mcp      — start MCP server over stdio
 * mindkit check    — check an action against guardrails
 * mindkit skills   — list all available skills
 * mindkit workflows — list all available workflows
 */

import { Command } from 'commander';
import { GuardrailEngine } from './guardrails.js';
import { SkillLoader } from './skill-loader.js';
import { MindkitMCPServer } from './mcp.js';

const program = new Command();

program
    .name('mindkit')
    .description('Universal agent guardrails, skills, and workflow runtime')
    .version('0.1.0');

// ── mindkit init ──────────────────────────────────────────────────────────────
program
    .command('init')
    .description('Scaffold .agent/ directory structure into the current project')
    .option('--dir <path>', 'Target directory (default: current dir)', process.cwd())
    .action((opts) => {
        const loader = new SkillLoader(opts.dir);
        loader.scaffold(opts.dir);
        console.log(`✅ Mindkit initialized at ${opts.dir}/.agent/`);
        console.log('\nCreated:');
        console.log('  .agent/skills/example-skill.md');
        console.log('  .agent/workflows/example.md');
        console.log('  .agent/GUARDRAILS.md');
        console.log('\nAdd your own skills to .agent/skills/ and workflows to .agent/workflows/');
    });

// ── mindkit mcp ───────────────────────────────────────────────────────────────
program
    .command('mcp')
    .description('Start the Mindkit MCP server over stdio (for AI agent integration)')
    .option('--dir <path>', 'Working directory to scan for .agent/', process.cwd())
    .action(async (opts) => {
        const server = new MindkitMCPServer(opts.dir);
        await server.start();
        // Keep process alive — stdin stays open
    });

// ── mindkit check ─────────────────────────────────────────────────────────────
program
    .command('check')
    .description('Check an action against guardrails')
    .argument('[action]', 'Action text to check (reads from stdin if omitted)')
    .option('--tokens <n>', 'Estimated token count', '0')
    .option('--files <files>', 'Comma-separated list of files to modify')
    .option('--destructive', 'Flag action as destructive')
    .option('--json', 'Output as JSON')
    .action(async (action, opts) => {
        const ctx = {
            action: action ?? 'no action specified',
            tokenCount: parseInt(opts.tokens) || undefined,
            filesToModify: opts.files?.split(',').map((f: string) => f.trim()),
            isDestructive: opts.destructive ?? false,
        };

        const engine = new GuardrailEngine();
        const result = engine.check(ctx);

        if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(engine.format(result));
        }

        if (!result.passed) process.exit(1);
    });

// ── mindkit skills ────────────────────────────────────────────────────────────
program
    .command('skills')
    .description('List all available skills from .agent/skills/')
    .option('--dir <path>', 'Working directory', process.cwd())
    .option('--name <name>', 'Get details for a specific skill')
    .action((opts) => {
        const loader = new SkillLoader(opts.dir);

        if (opts.name) {
            const skill = loader.getSkill(opts.name);
            if (!skill) {
                console.error(`Skill "${opts.name}" not found`);
                process.exit(1);
            }
            console.log(`# ${skill.name}\n`);
            console.log(`Description: ${skill.description}`);
            console.log(`Tags: ${skill.tags.join(', ')}\n`);
            console.log(skill.instructions);
            return;
        }

        const skills = loader.loadSkills();
        if (skills.length === 0) {
            console.log('No skills found. Run `mindkit init` to scaffold .agent/');
            return;
        }
        console.log(`Found ${skills.length} skill(s):\n`);
        for (const s of skills) {
            console.log(`  ${s.name.padEnd(25)} ${s.description}`);
        }
    });

// ── mindkit workflows ─────────────────────────────────────────────────────────
program
    .command('workflows')
    .description('List all available workflows from .agent/workflows/')
    .option('--dir <path>', 'Working directory', process.cwd())
    .option('--name <name>', 'Get details for a specific workflow')
    .action((opts) => {
        const loader = new SkillLoader(opts.dir);

        if (opts.name) {
            const workflow = loader.getWorkflow(opts.name);
            if (!workflow) {
                console.error(`Workflow "${opts.name}" not found`);
                process.exit(1);
            }
            console.log(`# ${workflow.slashCommand}\n`);
            console.log(`Description: ${workflow.description}\n`);
            console.log('Steps:');
            for (const step of workflow.steps) {
                const turbo = step.isTurbo ? ' [turbo]' : '';
                console.log(`  ${step.number}. ${step.description}${turbo}`);
            }
            return;
        }

        const workflows = loader.loadWorkflows();
        if (workflows.length === 0) {
            console.log('No workflows found. Run `mindkit init` to scaffold .agent/');
            return;
        }
        console.log(`Found ${workflows.length} workflow(s):\n`);
        for (const w of workflows) {
            console.log(`  ${w.slashCommand.padEnd(25)} ${w.description} (${w.steps.length} steps)`);
        }
    });

program.parse();
