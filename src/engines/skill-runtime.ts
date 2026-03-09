import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { SkillCardRegistry, type SkillCard } from './skill-card.js';
import {
    BUILTIN_SKILL_PACKS,
    detectDomains,
    readMarkdownArtifacts,
    slugify,
    type RuntimeBinding,
    type RuntimeBindingType,
    type SkillCheckpoint,
    type SkillRiskClass,
    type SkillScope,
} from './runtime-assets.js';

export type { SkillCheckpoint, SkillRiskClass, SkillScope, RuntimeBinding as SkillBinding, RuntimeBindingType as SkillBindingType };

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
    domain?: string;
    instructions: string;
    toolBindings: RuntimeBinding[];
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

export interface SkillDerivationSignal {
    goal: string;
    workerCount: number;
    memoryMatches?: string[];
    repeatedFailures?: number;
    sessionHints?: string[];
}

export class SkillRuntime {
    private rootDir: string;
    private workspaceRoot: string;
    private artifacts = new Map<string, SkillArtifact>();
    private bootstrapped = false;

    constructor(private registry?: SkillCardRegistry, rootDir?: string, workspaceRoot?: string) {
        this.rootDir = rootDir ?? path.join(os.tmpdir(), 'nexus-prime-runtime-skills');
        this.workspaceRoot = workspaceRoot ?? process.cwd();
        fs.mkdirSync(this.rootDir, { recursive: true });
        this.ensureBootstrapped();
    }

    getArtifact(skillId: string): SkillArtifact | undefined {
        this.ensureBootstrapped();
        return this.artifacts.get(skillId);
    }

    findByName(name: string): SkillArtifact | undefined {
        this.ensureBootstrapped();
        const normalized = name.toLowerCase();
        return this.listArtifacts().find((artifact) =>
            artifact.name.toLowerCase() === normalized || artifact.skillId.toLowerCase() === normalized
        );
    }

    listArtifacts(): SkillArtifact[] {
        this.ensureBootstrapped();
        return [...this.artifacts.values()].sort((a, b) => {
            if ((a.scope === 'global' || a.scope === 'base') && b.scope !== 'global' && b.scope !== 'base') return -1;
            if ((b.scope === 'global' || b.scope === 'base') && a.scope !== 'global' && a.scope !== 'base') return 1;
            return a.name.localeCompare(b.name);
        });
    }

    createSkill(input: {
        name: string;
        domain?: string;
        instructions: string;
        toolBindings: RuntimeBinding[];
        riskClass: SkillRiskClass;
        scope: SkillScope;
        provenance: string;
    }): SkillArtifact {
        const artifact: SkillArtifact = {
            skillId: `skill_${randomUUID().slice(0, 8)}`,
            version: 1,
            name: input.name,
            domain: input.domain,
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

    resolveSkillSelectors(names: string[], goal: string): SkillArtifact[] {
        this.ensureBootstrapped();
        const selectors = new Set(names.map((name) => name.toLowerCase()));
        const domains = detectDomains(goal, names);

        return dedupeSkills(this.listArtifacts().filter((artifact) =>
            selectors.has(artifact.name.toLowerCase()) ||
            selectors.has(artifact.skillId.toLowerCase()) ||
            (artifact.domain ? domains.includes(artifact.domain) : false)
        ));
    }

    generateRuntimeSkills(goal: string, workerCount: number, signal: Partial<SkillDerivationSignal> = {}): SkillArtifact[] {
        this.ensureBootstrapped();
        const runtimeSkills: SkillArtifact[] = [];
        runtimeSkills.push(this.createSkill({
            name: `focused-read-${slugify(goal).slice(0, 24) || 'run'}`,
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
            runtimeSkills.push(this.createSkill({
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

        const matchedDomains = detectDomains(goal, signal.memoryMatches ?? []);
        const bundledMatches = this.listArtifacts()
            .filter((artifact) => artifact.scope === 'base' && artifact.domain && matchedDomains.includes(artifact.domain))
            .slice(0, 4);
        const derived = this.deriveFromSignals({
            goal,
            workerCount,
            memoryMatches: signal.memoryMatches,
            repeatedFailures: signal.repeatedFailures,
            sessionHints: signal.sessionHints,
        });

        return dedupeSkills([...runtimeSkills, ...bundledMatches, ...derived]);
    }

    deriveFromSignals(signal: SkillDerivationSignal): SkillArtifact[] {
        const derived: SkillArtifact[] = [];
        const domains = detectDomains(signal.goal, signal.memoryMatches ?? []);

        if ((signal.repeatedFailures ?? 0) > 0) {
            derived.push(this.createSkill({
                name: `derived-retry-skill-${slugify(signal.goal).slice(0, 18)}`,
                domain: domains[0] ?? 'workflows',
                instructions: [
                    'Analyze the failing verifier commands before retrying.',
                    'Reduce mutation scope to the smallest failing surface.',
                    'Document why the retry plan is different from the previous pass.',
                ].join('\n'),
                toolBindings: [],
                riskClass: 'orchestrate',
                scope: 'session',
                provenance: `derived:failure-cluster:${signal.repeatedFailures}`,
            }));
        }

        for (const domain of domains.slice(0, 2)) {
            derived.push(this.createSkill({
                name: `derived-${domain}-pattern-${slugify(signal.goal).slice(0, 18)}`,
                domain,
                instructions: [
                    `Leverage prior ${domain} learnings from memory before expanding scope.`,
                    'Extract the reusable checklist from successful runs and apply it to this task.',
                    'Only promote the pattern if verification improves.',
                ].join('\n'),
                toolBindings: [],
                riskClass: 'read',
                scope: 'session',
                provenance: `derived:memory:${domain}`,
            }));
        }

        return dedupeSkills(derived);
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
        const fileName = `${slugify(artifact.name).toLowerCase() || artifact.skillId}.md`;
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

    private ensureBootstrapped(): void {
        if (this.bootstrapped) return;
        this.loadBundledDefaults();
        this.loadLocalOverrides();
        this.bootstrapped = true;
    }

    private loadBundledDefaults(): void {
        for (const seed of BUILTIN_SKILL_PACKS) {
            this.stage({
                skillId: `skill_${slugify(seed.key)}`,
                version: 1,
                name: seed.name,
                domain: seed.domain,
                instructions: seed.instructions.join('\n'),
                toolBindings: seed.toolBindings,
                riskClass: seed.riskClass,
                scope: seed.scope,
                provenance: 'bundled',
                validationStatus: 'validated',
                rolloutStatus: 'promoted',
                effectiveness: {
                    successes: 0,
                    failures: 0,
                    tokenDelta: 0,
                    retriesAvoided: 0,
                    verificationPasses: 0,
                },
                deploymentPoints: [],
            });
        }
    }

    private loadLocalOverrides(): void {
        const skillDir = path.join(this.workspaceRoot, '.agent', 'skills');
        for (const entry of readMarkdownArtifacts(skillDir)) {
            const frontmatter = entry.parsed.frontmatter;
            const name = String(frontmatter.name ?? path.basename(entry.path, '.md'));
            this.stage({
                skillId: `skill_local_${slugify(name)}`,
                version: 1,
                name,
                domain: String(frontmatter.domain ?? detectDomains(name)[0] ?? ''),
                instructions: entry.parsed.body,
                toolBindings: [],
                riskClass: normalizeRiskClass(frontmatter.riskClass),
                scope: 'base',
                provenance: `local:${entry.path}`,
                validationStatus: 'validated',
                rolloutStatus: 'promoted',
                effectiveness: {
                    successes: 0,
                    failures: 0,
                    tokenDelta: 0,
                    retriesAvoided: 0,
                    verificationPasses: 0,
                },
                deploymentPoints: [],
            });
        }
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
            `tags: [runtime, ${artifact.scope}, ${artifact.riskClass}${artifact.domain ? `, ${artifact.domain}` : ''}]`,
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

function normalizeRiskClass(value: unknown): SkillRiskClass {
    return value === 'mutate' || value === 'orchestrate' ? value : 'read';
}

function dedupeSkills(skills: SkillArtifact[]): SkillArtifact[] {
    const seen = new Set<string>();
    return skills.filter((skill) => {
        const key = skill.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export const createSkillRuntime = (registry?: SkillCardRegistry, rootDir?: string, workspaceRoot?: string) =>
    new SkillRuntime(registry, rootDir, workspaceRoot);
