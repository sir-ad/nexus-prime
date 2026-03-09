import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { SkillCardRegistry, type SkillCard } from './skill-card.js';

export type SkillRiskClass = 'read' | 'orchestrate' | 'mutate';
export type SkillScope = 'base' | 'session' | 'worker' | 'runtime-hot' | 'global';
export type SkillCheckpoint = 'before-read' | 'before-mutate' | 'before-verify' | 'retry';

export type SkillBindingType =
    | 'write_file'
    | 'append_file'
    | 'replace_text'
    | 'run_command';

export interface SkillBinding {
    type: SkillBindingType;
    path?: string;
    content?: string;
    search?: string;
    replace?: string;
    command?: string;
}

export interface SkillValidationResult {
    valid: boolean;
    errors: string[];
    hotDeployAllowed: boolean;
}

export interface SkillDeploymentRecord {
    workerId: string;
    checkpoint: SkillCheckpoint;
    deployedAt: number;
    worktreeDir: string;
}

export interface SkillArtifact {
    skillId: string;
    version: number;
    name: string;
    instructions: string;
    toolBindings: SkillBinding[];
    riskClass: SkillRiskClass;
    scope: SkillScope;
    provenance: string;
    validationStatus: 'pending' | 'validated' | 'rejected';
    rolloutStatus: 'staged' | 'hot' | 'promoted' | 'revoked';
    effectiveness: {
        successes: number;
        failures: number;
        tokenDelta: number;
        retriesAvoided: number;
        verificationPasses: number;
    };
    deploymentPoints: SkillDeploymentRecord[];
}

export interface SkillRuntimeMetrics {
    success: boolean;
    tokenDelta?: number;
    retriesAvoided?: number;
    verificationPassed?: boolean;
}

export class SkillRuntime {
    private rootDir: string;
    private artifacts = new Map<string, SkillArtifact>();

    constructor(private registry?: SkillCardRegistry, rootDir?: string) {
        this.rootDir = rootDir ?? path.join(os.tmpdir(), 'nexus-prime-runtime-skills');
        fs.mkdirSync(this.rootDir, { recursive: true });
    }

    getArtifact(skillId: string): SkillArtifact | undefined {
        return this.artifacts.get(skillId);
    }

    listArtifacts(): SkillArtifact[] {
        return [...this.artifacts.values()];
    }

    createSkill(input: {
        name: string;
        instructions: string;
        toolBindings: SkillBinding[];
        riskClass: SkillRiskClass;
        scope: SkillScope;
        provenance: string;
    }): SkillArtifact {
        const artifact: SkillArtifact = {
            skillId: `skill_${randomUUID().slice(0, 8)}`,
            version: 1,
            name: input.name,
            instructions: input.instructions,
            toolBindings: input.toolBindings,
            riskClass: input.riskClass,
            scope: input.scope,
            provenance: input.provenance,
            validationStatus: 'pending',
            rolloutStatus: 'staged',
            effectiveness: {
                successes: 0,
                failures: 0,
                tokenDelta: 0,
                retriesAvoided: 0,
                verificationPasses: 0,
            },
            deploymentPoints: [],
        };

        this.stage(artifact);
        return artifact;
    }

    generateRuntimeSkills(goal: string, workerCount: number): SkillArtifact[] {
        const skills: SkillArtifact[] = [];
        skills.push(this.createSkill({
            name: `focused-read-${goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'run'}`,
            instructions: [
                'Prioritize the assigned reading plan before full-file exploration.',
                'Store concrete learnings before expanding scope.',
                'Do not mutate files during the read checkpoint.',
            ].join('\n'),
            toolBindings: [],
            riskClass: 'read',
            scope: 'runtime-hot',
            provenance: `runtime:auto-read:${workerCount}`,
        }));

        if (workerCount > 1) {
            skills.push(this.createSkill({
                name: `parallel-orchestrate-${workerCount}-workers`,
                instructions: [
                    'Share findings through POD before duplicate work.',
                    'Keep worktree mutations scoped to assigned files.',
                    'Request verification after each non-trivial diff.',
                ].join('\n'),
                toolBindings: [],
                riskClass: 'orchestrate',
                scope: 'runtime-hot',
                provenance: `runtime:auto-orchestrate:${workerCount}`,
            }));
        }

        return skills;
    }

    validate(artifact: SkillArtifact): SkillValidationResult {
        const errors: string[] = [];
        if (!artifact.name.trim()) errors.push('Skill name is required.');
        if (!artifact.instructions.trim()) errors.push('Skill instructions are required.');

        const mutateWithoutBinding = artifact.riskClass === 'mutate' && artifact.toolBindings.length === 0;
        if (mutateWithoutBinding) errors.push('Mutating skills must define at least one tool binding.');

        for (const binding of artifact.toolBindings) {
            if (binding.type === 'write_file' || binding.type === 'append_file') {
                if (!binding.path) errors.push(`${binding.type} requires a path.`);
            }
            if (binding.type === 'replace_text') {
                if (!binding.path || binding.search === undefined || binding.replace === undefined) {
                    errors.push('replace_text requires path, search, and replace.');
                }
            }
            if (binding.type === 'run_command' && !binding.command) {
                errors.push('run_command requires a command.');
            }
        }

        const hotDeployAllowed = artifact.riskClass !== 'mutate';
        artifact.validationStatus = errors.length === 0 ? 'validated' : 'rejected';
        this.persistArtifact(artifact);

        return {
            valid: errors.length === 0,
            errors,
            hotDeployAllowed,
        };
    }

    stage(artifact: SkillArtifact): SkillArtifact {
        this.artifacts.set(artifact.skillId, artifact);
        this.persistArtifact(artifact);
        this.registerSkillCard(artifact);
        return artifact;
    }

    deploy(artifact: SkillArtifact, workerId: string, worktreeDir: string, checkpoint: SkillCheckpoint): SkillArtifact {
        const validation = this.validate(artifact);
        if (!validation.valid) {
            throw new Error(`Skill ${artifact.name} failed validation: ${validation.errors.join('; ')}`);
        }

        const deployDir = path.join(worktreeDir, '.agent', 'skills', 'runtime');
        fs.mkdirSync(deployDir, { recursive: true });
        const fileName = `${artifact.name.replace(/[^a-z0-9\-]+/gi, '-').toLowerCase() || artifact.skillId}.md`;
        fs.writeFileSync(path.join(deployDir, fileName), this.renderMarkdown(artifact), 'utf-8');

        artifact.rolloutStatus = checkpoint === 'before-verify' && artifact.riskClass === 'mutate' ? 'staged' : 'hot';
        artifact.deploymentPoints.push({
            workerId,
            checkpoint,
            deployedAt: Date.now(),
            worktreeDir,
        });
        this.persistArtifact(artifact);
        return artifact;
    }

    recordOutcome(skillId: string, metrics: SkillRuntimeMetrics): SkillArtifact | undefined {
        const artifact = this.artifacts.get(skillId);
        if (!artifact) return undefined;

        if (metrics.success) artifact.effectiveness.successes++;
        else artifact.effectiveness.failures++;
        artifact.effectiveness.tokenDelta += metrics.tokenDelta ?? 0;
        artifact.effectiveness.retriesAvoided += metrics.retriesAvoided ?? 0;
        artifact.effectiveness.verificationPasses += metrics.verificationPassed ? 1 : 0;

        if (artifact.effectiveness.failures > artifact.effectiveness.successes + 1) {
            artifact.rolloutStatus = 'revoked';
        } else if (artifact.effectiveness.successes >= 2 && artifact.scope !== 'global') {
            artifact.rolloutStatus = 'promoted';
            artifact.scope = artifact.riskClass === 'mutate' ? 'session' : 'global';
        }

        this.persistArtifact(artifact);
        return artifact;
    }

    promote(skillId: string, scope: SkillScope = 'global'): SkillArtifact | undefined {
        const artifact = this.artifacts.get(skillId);
        if (!artifact) return undefined;
        artifact.scope = scope;
        artifact.rolloutStatus = 'promoted';
        this.persistArtifact(artifact);
        return artifact;
    }

    revoke(skillId: string): SkillArtifact | undefined {
        const artifact = this.artifacts.get(skillId);
        if (!artifact) return undefined;
        artifact.rolloutStatus = 'revoked';
        this.persistArtifact(artifact);
        return artifact;
    }

    private persistArtifact(artifact: SkillArtifact): void {
        const dir = path.join(this.rootDir, artifact.skillId, `v${artifact.version}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'artifact.json'), JSON.stringify(artifact, null, 2), 'utf-8');
        fs.writeFileSync(path.join(dir, 'skill.md'), this.renderMarkdown(artifact), 'utf-8');
    }

    private renderMarkdown(artifact: SkillArtifact): string {
        const lines = [
            '---',
            `name: ${artifact.name}`,
            `description: Runtime-generated skill (${artifact.riskClass})`,
            `tags: [runtime, ${artifact.scope}, ${artifact.riskClass}]`,
            '---',
            '',
            `# ${artifact.name}`,
            '',
            '## Instructions',
            artifact.instructions,
        ];

        if (artifact.toolBindings.length > 0) {
            lines.push('', '## Tool Bindings');
            artifact.toolBindings.forEach(binding => {
                lines.push(`- ${binding.type}: ${JSON.stringify(binding)}`);
            });
        }

        return lines.join('\n');
    }

    private registerSkillCard(artifact: SkillArtifact): void {
        if (!this.registry) return;

        const card: SkillCard = {
            name: artifact.name,
            trigger: {
                logic: 'OR',
                conditions: [
                    {
                        field: 'task_keywords',
                        operator: 'contains',
                        value: artifact.name,
                    },
                ],
            },
            actions: artifact.toolBindings.map(binding => ({
                tool: binding.type,
                args: Object.fromEntries(
                    Object.entries(binding).flatMap(([key, value]) =>
                        key === 'type' || value === undefined ? [] : [[key, String(value)]]
                    )
                ),
            })),
            confidence: 0.7,
            adoptions: 0,
            origin: artifact.provenance,
        };

        this.registry.register(card);
    }
}

export const createSkillRuntime = (registry?: SkillCardRegistry, rootDir?: string) =>
    new SkillRuntime(registry, rootDir);
