import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
    BUILTIN_WORKFLOW_PACKS,
    detectDomains,
    readMarkdownArtifacts,
    slugify,
    type DomainWorkflowSeed,
    type RuntimeBinding,
    type SkillCheckpoint,
    type SkillScope,
} from './runtime-assets.js';

export interface WorkflowStep {
    title: string;
    command?: string;
    checkpoint?: SkillCheckpoint;
    role?: string;
    bindings: RuntimeBinding[];
}

export interface WorkflowDeploymentRecord {
    runId: string;
    deployedAt: number;
    scope: SkillScope;
}

export interface WorkflowArtifact {
    workflowId: string;
    version: number;
    name: string;
    domain: string;
    description: string;
    triggerConditions: string[];
    expectedOutputs: string[];
    guardrails: string[];
    verifierHooks: string[];
    roleAffinity: string[];
    steps: WorkflowStep[];
    scope: SkillScope;
    provenance: string;
    validationStatus: 'pending' | 'validated' | 'rejected';
    rolloutStatus: 'staged' | 'hot' | 'promoted' | 'revoked';
    effectiveness: {
        successes: number;
        failures: number;
        retriesAvoided: number;
        verificationPasses: number;
    };
    deploymentPoints: WorkflowDeploymentRecord[];
}

export interface WorkflowRuntimeMetrics {
    success: boolean;
    retriesAvoided?: number;
    verificationPassed?: boolean;
}

export interface WorkflowDerivationSignal {
    goal: string;
    memoryMatches?: string[];
    repeatedFailures?: number;
    sessionHints?: string[];
}

export class WorkflowRuntime {
    private rootDir: string;
    private workspaceRoot: string;
    private artifacts = new Map<string, WorkflowArtifact>();
    private bootstrapped = false;

    constructor(rootDir?: string, workspaceRoot?: string) {
        this.rootDir = rootDir ?? path.join(os.tmpdir(), 'nexus-prime-runtime-workflows');
        this.workspaceRoot = workspaceRoot ?? process.cwd();
        fs.mkdirSync(this.rootDir, { recursive: true });
        this.ensureBootstrapped();
    }

    listArtifacts(): WorkflowArtifact[] {
        this.ensureBootstrapped();
        return [...this.artifacts.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    getArtifact(workflowId: string): WorkflowArtifact | undefined {
        this.ensureBootstrapped();
        return this.artifacts.get(workflowId);
    }

    findByName(name: string): WorkflowArtifact | undefined {
        this.ensureBootstrapped();
        const normalized = name.toLowerCase();
        return this.listArtifacts().find((artifact) =>
            artifact.name.toLowerCase() === normalized || artifact.workflowId.toLowerCase() === normalized
        );
    }

    createWorkflow(input: Omit<WorkflowArtifact, 'workflowId' | 'version' | 'validationStatus' | 'rolloutStatus' | 'effectiveness' | 'deploymentPoints'>): WorkflowArtifact {
        const artifact: WorkflowArtifact = {
            ...input,
            workflowId: `workflow_${randomUUID().slice(0, 8)}`,
            version: 1,
            validationStatus: 'pending',
            rolloutStatus: 'staged',
            effectiveness: {
                successes: 0,
                failures: 0,
                retriesAvoided: 0,
                verificationPasses: 0,
            },
            deploymentPoints: [],
        };
        return this.stage(artifact);
    }

    stage(artifact: WorkflowArtifact): WorkflowArtifact {
        artifact.validationStatus = this.validate(artifact).valid ? 'validated' : 'rejected';
        this.artifacts.set(artifact.workflowId, artifact);
        this.persistArtifact(artifact);
        return artifact;
    }

    deploy(workflowId: string, runId: string, scope: SkillScope = 'session'): WorkflowArtifact | undefined {
        const artifact = this.artifacts.get(workflowId);
        if (!artifact) return undefined;
        artifact.scope = scope;
        artifact.rolloutStatus = scope === 'global' ? 'promoted' : 'hot';
        artifact.deploymentPoints.push({ runId, deployedAt: Date.now(), scope });
        this.persistArtifact(artifact);
        return artifact;
    }

    recordOutcome(workflowId: string, metrics: WorkflowRuntimeMetrics): WorkflowArtifact | undefined {
        const artifact = this.artifacts.get(workflowId);
        if (!artifact) return undefined;
        if (metrics.success) artifact.effectiveness.successes++;
        else artifact.effectiveness.failures++;
        artifact.effectiveness.retriesAvoided += metrics.retriesAvoided ?? 0;
        artifact.effectiveness.verificationPasses += metrics.verificationPassed ? 1 : 0;

        if (artifact.effectiveness.failures > artifact.effectiveness.successes + 1) {
            artifact.rolloutStatus = 'revoked';
        } else if (artifact.effectiveness.successes >= 2 && artifact.rolloutStatus !== 'promoted') {
            artifact.rolloutStatus = 'promoted';
            artifact.scope = 'global';
        }

        this.persistArtifact(artifact);
        return artifact;
    }

    revoke(workflowId: string): WorkflowArtifact | undefined {
        const artifact = this.artifacts.get(workflowId);
        if (!artifact) return undefined;
        artifact.rolloutStatus = 'revoked';
        this.persistArtifact(artifact);
        return artifact;
    }

    resolveWorkflowSelectors(names: string[], goal: string): WorkflowArtifact[] {
        this.ensureBootstrapped();
        const selectors = new Set(names.map((name) => name.toLowerCase()));
        const domains = detectDomains(goal, names);
        const matches = this.listArtifacts().filter((artifact) =>
            selectors.has(artifact.name.toLowerCase()) ||
            selectors.has(artifact.workflowId.toLowerCase()) ||
            domains.includes(artifact.domain)
        );

        return dedupeWorkflows(matches);
    }

    deriveFromSignals(signal: WorkflowDerivationSignal): WorkflowArtifact[] {
        const domains = detectDomains(signal.goal, signal.memoryMatches ?? []);
        const derived: WorkflowArtifact[] = [];

        if ((signal.repeatedFailures ?? 0) > 0) {
            derived.push(this.createWorkflow({
                name: `derived-retry-loop-${slugify(signal.goal).slice(0, 20)}`,
                domain: domains[0] ?? 'workflows',
                description: 'Derived retry workflow synthesized from repeated failures.',
                triggerConditions: ['run failure cluster', 'retry requested'],
                expectedOutputs: ['retry plan', 'focused verification'],
                guardrails: ['Restrict retry scope to the failing surface.', 'Attach verifier evidence before re-apply.'],
                verifierHooks: ['Re-run the smallest failing verifier first.'],
                roleAffinity: ['planner', 'verifier', 'skill-maker'],
                steps: [
                    { title: 'Identify failing commands and affected files', checkpoint: 'retry', role: 'planner', bindings: [] },
                    { title: 'Apply a narrowed retry plan', checkpoint: 'retry', role: 'coder', bindings: [] },
                    { title: 'Verify retry diff before promotion', checkpoint: 'before-verify', role: 'verifier', bindings: [] },
                ],
                scope: 'session',
                provenance: `derived:failure-cluster:${Math.max(signal.repeatedFailures ?? 1, 1)}`,
            }));
        }

        for (const domain of domains.slice(0, 2)) {
            derived.push(this.createWorkflow({
                name: `derived-${domain}-workflow-${slugify(signal.goal).slice(0, 18)}`,
                domain,
                description: `Derived ${domain} workflow from goal and memory overlap.`,
                triggerConditions: [`goal matched ${domain}`, 'memory overlap detected'],
                expectedOutputs: ['derived checklist', 'verifier evidence'],
                guardrails: ['Derived workflows must stay additive until verified.'],
                verifierHooks: ['Log the workflow evidence into the run ledger.'],
                roleAffinity: ['planner', 'coder', 'verifier'],
                steps: [
                    { title: `Plan ${domain} sub-problem`, checkpoint: 'before-read', role: 'planner', bindings: [] },
                    { title: `Execute ${domain} pass`, checkpoint: 'before-mutate', role: 'coder', bindings: [] },
                    { title: `Verify ${domain} outcome`, checkpoint: 'before-verify', role: 'verifier', bindings: [] },
                ],
                scope: 'session',
                provenance: `derived:domain:${domain}`,
            }));
        }

        return dedupeWorkflows(derived);
    }

    applyToTask(workflows: WorkflowArtifact[], currentVerifyCommands: string[], currentActions: RuntimeBinding[]): {
        verifyCommands: string[];
        actions: RuntimeBinding[];
        events: Array<Record<string, unknown>>;
    } {
        const verify = new Set(currentVerifyCommands);
        const actions = [...currentActions];
        const events = workflows.map((workflow) => ({
            type: 'workflow.selected',
            workflowId: workflow.workflowId,
            name: workflow.name,
            domain: workflow.domain,
            scope: workflow.scope,
        }));

        for (const workflow of workflows) {
            workflow.verifierHooks.forEach((hook) => {
                if (hook.includes('npm ') || hook.includes('pnpm ') || hook.includes('node ')) {
                    verify.add(hook);
                }
            });
            workflow.steps.forEach((step) => {
                if (step.command) verify.add(step.command);
                actions.push(...step.bindings);
            });
        }

        return {
            verifyCommands: [...verify],
            actions,
            events,
        };
    }

    private validate(artifact: WorkflowArtifact): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        if (!artifact.name.trim()) errors.push('Workflow name is required.');
        if (artifact.steps.length === 0) errors.push('Workflow must contain at least one step.');
        return { valid: errors.length === 0, errors };
    }

    private ensureBootstrapped(): void {
        if (this.bootstrapped) return;
        this.loadBundledDefaults();
        this.loadLocalOverrides();
        this.bootstrapped = true;
    }

    private loadBundledDefaults(): void {
        for (const seed of BUILTIN_WORKFLOW_PACKS) {
            this.ingestSeed(seed, 'bundled');
        }
    }

    private loadLocalOverrides(): void {
        const workflowDir = path.join(this.workspaceRoot, '.agent', 'workflows');
        for (const entry of readMarkdownArtifacts(workflowDir)) {
            const frontmatter = entry.parsed.frontmatter;
            const lines = entry.parsed.body.split('\n');
            const steps: WorkflowStep[] = lines
                .map((line) => line.match(/^(\d+)\.\s+(.+)$/))
                .filter(Boolean)
                .map((match) => ({
                    title: String(match?.[2] ?? '').trim(),
                    command: extractCommand(String(match?.[2] ?? '')),
                    checkpoint: 'before-mutate' as SkillCheckpoint,
                    bindings: [],
                }));

            const name = String(frontmatter.name ?? path.basename(entry.path, '.md'));
            this.stage({
                workflowId: `workflow_local_${slugify(name)}`,
                version: 1,
                name,
                domain: String(frontmatter.domain ?? detectDomains(name)[0] ?? 'workflows'),
                description: String(frontmatter.description ?? ''),
                triggerConditions: toStringArray(frontmatter.triggers),
                expectedOutputs: toStringArray(frontmatter.outputs),
                guardrails: toStringArray(frontmatter.guardrails),
                verifierHooks: toStringArray(frontmatter.verify),
                roleAffinity: toStringArray(frontmatter.roles),
                steps,
                scope: 'base',
                provenance: `local:${entry.path}`,
                validationStatus: 'validated',
                rolloutStatus: 'promoted',
                effectiveness: {
                    successes: 0,
                    failures: 0,
                    retriesAvoided: 0,
                    verificationPasses: 0,
                },
                deploymentPoints: [],
            });
        }
    }

    private ingestSeed(seed: DomainWorkflowSeed, provenance: string): void {
        this.stage({
            workflowId: `workflow_${slugify(seed.key)}`,
            version: 1,
            name: seed.name,
            domain: seed.domain,
            description: seed.description,
            triggerConditions: seed.triggerConditions,
            expectedOutputs: seed.expectedOutputs,
            guardrails: seed.guardrails,
            verifierHooks: seed.verifierHooks,
            roleAffinity: seed.roleAffinity,
            steps: seed.steps.map((step) => ({
                title: step.title,
                command: step.command,
                checkpoint: step.checkpoint,
                role: step.role,
                bindings: step.bindings ?? [],
            })),
            scope: 'base',
            provenance,
            validationStatus: 'validated',
            rolloutStatus: 'promoted',
            effectiveness: {
                successes: 0,
                failures: 0,
                retriesAvoided: 0,
                verificationPasses: 0,
            },
            deploymentPoints: [],
        });
    }

    private persistArtifact(artifact: WorkflowArtifact): void {
        const dir = path.join(this.rootDir, artifact.workflowId, `v${artifact.version}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'artifact.json'), JSON.stringify(artifact, null, 2), 'utf-8');
    }
}

function extractCommand(value: string): string | undefined {
    const match = value.match(/`([^`]+)`/);
    return match?.[1];
}

function toStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function dedupeWorkflows(artifacts: WorkflowArtifact[]): WorkflowArtifact[] {
    const seen = new Set<string>();
    return artifacts.filter((artifact) => {
        const key = artifact.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export const createWorkflowRuntime = (rootDir?: string, workspaceRoot?: string) =>
    new WorkflowRuntime(rootDir, workspaceRoot);
