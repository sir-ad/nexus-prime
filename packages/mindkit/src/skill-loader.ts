/**
 * Mindkit Skill Loader
 *
 * Loads agent skills from .agent/skills/**\/*.md files at runtime.
 * Skills are markdown files with YAML frontmatter (name, description, tags).
 *
 * Directory structure:
 *   .agent/
 *     skills/
 *       search.md
 *       code-review.md
 *       ... any custom skills
 *     workflows/
 *       deploy.md
 *       quick-check.md
 */

import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Skill {
    name: string;
    description: string;
    tags: string[];
    instructions: string;   // full markdown body
    source: string;         // file path
}

export interface Workflow {
    name: string;
    description: string;
    steps: WorkflowStep[];
    slashCommand: string;   // e.g. /deploy-prep
    isTurboAll: boolean;    // // turbo-all annotation present
    source: string;
}

export interface WorkflowStep {
    number: number;
    description: string;
    command?: string;       // shell command if present
    isTurbo: boolean;       // // turbo annotation above step
}

// ─────────────────────────────────────────────────────────────────────────────
// SkillLoader
// ─────────────────────────────────────────────────────────────────────────────

export class SkillLoader {
    private agentDir: string;

    constructor(cwd?: string) {
        this.agentDir = path.join(cwd ?? process.cwd(), '.agent');
    }

    // ── Skills ───────────────────────────────────────────────────────────────

    loadSkills(): Skill[] {
        const skillsDir = path.join(this.agentDir, 'skills');
        if (!fs.existsSync(skillsDir)) return [];

        const files = this.findMarkdownFiles(skillsDir);
        return files.map(f => this.parseSkill(f)).filter(Boolean) as Skill[];
    }

    getSkill(name: string): Skill | null {
        const skills = this.loadSkills();
        return skills.find(s =>
            s.name.toLowerCase() === name.toLowerCase() ||
            path.basename(s.source, '.md').toLowerCase() === name.toLowerCase()
        ) ?? null;
    }

    // ── Workflows ─────────────────────────────────────────────────────────────

    loadWorkflows(): Workflow[] {
        const workflowsDir = path.join(this.agentDir, 'workflows');
        if (!fs.existsSync(workflowsDir)) return [];

        const files = this.findMarkdownFiles(workflowsDir);
        return files.map(f => this.parseWorkflow(f)).filter(Boolean) as Workflow[];
    }

    getWorkflow(slashCommand: string): Workflow | null {
        const cmd = slashCommand.startsWith('/') ? slashCommand : `/${slashCommand}`;
        return this.loadWorkflows().find(w => w.slashCommand === cmd) ?? null;
    }

    // ── Scaffolding ───────────────────────────────────────────────────────────

    /** Scaffold .agent/ directory structure in cwd */
    scaffold(cwd?: string): void {
        const base = cwd ?? process.cwd();
        const dirs = [
            path.join(base, '.agent', 'skills'),
            path.join(base, '.agent', 'workflows'),
            path.join(base, '.agent', 'rules'),
            path.join(base, '.agent', 'memory'),
        ];

        for (const dir of dirs) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Write example skill
        const exampleSkill = `---
name: example-skill
description: A template skill — replace with your own
tags: [example, template]
---

# Example Skill

## When to Use
Describe when an agent should activate this skill.

## Steps
1. Step one
2. Step two
3. Step three

## Output Format
What format the skill should produce.
`;
        const skillPath = path.join(base, '.agent', 'skills', 'example-skill.md');
        if (!fs.existsSync(skillPath)) {
            fs.writeFileSync(skillPath, exampleSkill, 'utf-8');
        }

        // Write example workflow
        const exampleWorkflow = `---
description: Example workflow — replace with your own
---
# Example Workflow

1. First step
2. Second step
// turbo
3. Third step (auto-run)
`;
        const workflowPath = path.join(base, '.agent', 'workflows', 'example.md');
        if (!fs.existsSync(workflowPath)) {
            fs.writeFileSync(workflowPath, exampleWorkflow, 'utf-8');
        }

        // Write GUARDRAILS.md
        const guardrails = `# Mindkit Guardrails

Rules enforced by the mindkit runtime for this project.

## Token Budget
- Warn at 70k tokens
- Error at 100k tokens

## Destructive Operations
- Require confirmation before delete/drop/wipe operations

## Memory First
- Check memory before researching topics you may already know

## Custom Rules
Add project-specific rules here.
`;
        const guardrailsPath = path.join(base, '.agent', 'GUARDRAILS.md');
        if (!fs.existsSync(guardrailsPath)) {
            fs.writeFileSync(guardrailsPath, guardrails, 'utf-8');
        }
    }

    // ── Parsers ───────────────────────────────────────────────────────────────

    private parseSkill(filePath: string): Skill | null {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const { frontmatter, body } = this.splitFrontmatter(raw);

            return {
                name: frontmatter.name ?? path.basename(filePath, '.md'),
                description: frontmatter.description ?? '',
                tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
                instructions: body.trim(),
                source: filePath
            };
        } catch {
            return null;
        }
    }

    private parseWorkflow(filePath: string): Workflow | null {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const { frontmatter, body } = this.splitFrontmatter(raw);

            const slashName = path.basename(filePath, '.md');
            const isTurboAll = body.includes('// turbo-all');
            const steps = this.parseWorkflowSteps(body);

            return {
                name: slashName,
                description: frontmatter.description ?? '',
                slashCommand: `/${slashName}`,
                steps,
                isTurboAll,
                source: filePath
            };
        } catch {
            return null;
        }
    }

    private parseWorkflowSteps(body: string): WorkflowStep[] {
        const lines = body.split('\n');
        const steps: WorkflowStep[] = [];
        let isTurbo = false;

        for (const line of lines) {
            if (line.trim() === '// turbo') {
                isTurbo = true;
                continue;
            }

            const stepMatch = line.match(/^(\d+)\.\s+(.+)/);
            if (stepMatch) {
                const desc = stepMatch[2].trim();
                const cmdMatch = desc.match(/`([^`]+)`/);
                steps.push({
                    number: parseInt(stepMatch[1]),
                    description: desc,
                    command: cmdMatch?.[1],
                    isTurbo
                });
                isTurbo = false; // reset after consuming
            }
        }

        return steps;
    }

    private splitFrontmatter(raw: string): { frontmatter: Record<string, any>; body: string } {
        if (!raw.startsWith('---')) {
            return { frontmatter: {}, body: raw };
        }

        const end = raw.indexOf('---', 3);
        if (end === -1) return { frontmatter: {}, body: raw };

        const yamlBlock = raw.slice(3, end).trim();
        const body = raw.slice(end + 3).trim();
        const frontmatter = this.parseYaml(yamlBlock);

        return { frontmatter, body };
    }

    private parseYaml(yaml: string): Record<string, any> {
        const result: Record<string, any> = {};
        for (const line of yaml.split('\n')) {
            const match = line.match(/^(\w[\w-]*):\s*(.*)$/);
            if (!match) continue;
            const key = match[1];
            const val = match[2].trim();

            if (val.startsWith('[') && val.endsWith(']')) {
                result[key] = val.slice(1, -1).split(',').map(v => v.trim().replace(/['"]/g, ''));
            } else {
                result[key] = val.replace(/^['"]|['"]$/g, '');
            }
        }
        return result;
    }

    private findMarkdownFiles(dir: string): string[] {
        const results: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...this.findMarkdownFiles(full));
            } else if (entry.name.endsWith('.md')) {
                results.push(full);
            }
        }
        return results;
    }
}

export const createSkillLoader = (cwd?: string) => new SkillLoader(cwd);
