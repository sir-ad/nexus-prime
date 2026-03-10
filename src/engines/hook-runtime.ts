import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
    detectDomains,
    readMarkdownArtifacts,
    slugify,
    type HookTrigger,
    type RuntimeBinding,
    type SkillRiskClass,
    type SkillScope,
} from './runtime-assets.js';

export interface HookArtifact {
    hookId: string;
    version: number;
    name: string;
    description: string;
    domain?: string;
    trigger: HookTrigger;
    conditions: string[];
    guardrails: string[];
    skillSelectors: string[];
    workflowSelectors: string[];
    toolBindings: RuntimeBinding[];
    riskClass: SkillRiskClass;
    scope: SkillScope;
    provenance: string;
    validationStatus: 'pending' | 'validated' | 'rejected';
    rolloutStatus: 'staged' | 'hot' | 'promoted' | 'revoked';
    effectiveness: {
        fired: number;
        blocked: number;
        queued: number;
    };
}

export interface HookDispatchResult {
    trigger: HookTrigger;
    blocked: boolean;
    events: Array<Record<string, unknown>>;
    notes: string[];
    workflowSelectors: string[];
    skillSelectors: string[];
    toolBindings: RuntimeBinding[];
}

interface HookSeed {
    name: string;
    description: string;
    trigger: HookTrigger;
    riskClass: SkillRiskClass;
    conditions: string[];
    guardrails: string[];
    skillSelectors?: string[];
    workflowSelectors?: string[];
    toolBindings?: RuntimeBinding[];
    domain?: string;
}

const BUILTIN_HOOKS: HookSeed[] = [
    {
        name: 'run-created-brief',
        description: 'Attach planning context and default orchestration on run creation.',
        trigger: 'run.created',
        riskClass: 'read',
        conditions: ['run created'],
        guardrails: ['Do not widen scope before reading plan is available.'],
        skillSelectors: ['orchestration-playbook'],
        workflowSelectors: ['workflows-execution-loop'],
        domain: 'orchestration',
    },
    {
        name: 'before-verify-approval',
        description: 'Attach approval-loop workflows before verification for domain work.',
        trigger: 'before-verify',
        riskClass: 'orchestrate',
        conditions: ['verification checkpoint'],
        guardrails: ['Do not skip verifier evidence before promotion.'],
        workflowSelectors: ['workflows-approval-loop'],
        domain: 'workflows',
    },
    {
        name: 'retry-narrow-scope',
        description: 'Focus retries on the failing surface after an error cluster.',
        trigger: 'retry',
        riskClass: 'orchestrate',
        conditions: ['retry requested'],
        guardrails: ['Do not widen retry scope without new evidence.'],
        workflowSelectors: ['workflows-execution-loop'],
        domain: 'workflows',
    },
    {
        name: 'memory-shield-escalation',
        description: 'Flag stored memories for shield review when policy risk is detected.',
        trigger: 'memory.stored',
        riskClass: 'read',
        conditions: ['high priority memory stored'],
        guardrails: ['Do not promote quarantined memory into global patterns.'],
        skillSelectors: ['security-reviewer'],
        domain: 'security',
    },
    {
        name: 'promotion-audit',
        description: 'Require a security-oriented audit note on promotion approval.',
        trigger: 'promotion.approved',
        riskClass: 'read',
        conditions: ['promotion approved'],
        guardrails: ['Do not silently promote unverified mutate artifacts.'],
        skillSelectors: ['security-reviewer'],
        workflowSelectors: ['security-approval-loop'],
        domain: 'security',
    },
];

export class HookRuntime {
    private rootDir: string;
    private workspaceRoot: string;
    private artifacts = new Map<string, HookArtifact>();
    private bootstrapped = false;

    constructor(rootDir?: string, workspaceRoot?: string) {
        this.rootDir = rootDir ?? path.join(os.tmpdir(), 'nexus-prime-runtime-hooks');
        this.workspaceRoot = workspaceRoot ?? process.cwd();
        fs.mkdirSync(this.rootDir, { recursive: true });
        this.ensureBootstrapped();
    }

    listArtifacts(): HookArtifact[] {
        this.ensureBootstrapped();
        return [...this.artifacts.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    getArtifact(hookId: string): HookArtifact | undefined {
        this.ensureBootstrapped();
        return this.artifacts.get(hookId);
    }

    findByName(name: string): HookArtifact | undefined {
        this.ensureBootstrapped();
        const normalized = name.toLowerCase();
        return this.listArtifacts().find((artifact) =>
            artifact.name.toLowerCase() === normalized || artifact.hookId.toLowerCase() === normalized
        );
    }

    createHook(input: Omit<HookArtifact, 'hookId' | 'version' | 'validationStatus' | 'rolloutStatus' | 'effectiveness'>): HookArtifact {
        const artifact: HookArtifact = {
            ...input,
            hookId: `hook_${randomUUID().slice(0, 8)}`,
            version: 1,
            validationStatus: 'pending',
            rolloutStatus: 'staged',
            effectiveness: { fired: 0, blocked: 0, queued: 0 },
        };
        return this.stage(artifact);
    }

    deploy(hookId: string, scope: SkillScope = 'session'): HookArtifact | undefined {
        const artifact = this.artifacts.get(hookId);
        if (!artifact) return undefined;
        artifact.scope = scope;
        artifact.rolloutStatus = scope === 'global' ? 'promoted' : 'hot';
        this.persistArtifact(artifact);
        return artifact;
    }

    revoke(hookId: string): HookArtifact | undefined {
        const artifact = this.artifacts.get(hookId);
        if (!artifact) return undefined;
        artifact.rolloutStatus = 'revoked';
        this.persistArtifact(artifact);
        return artifact;
    }

    resolveHookSelectors(names: string[], goal: string, trigger?: HookTrigger): HookArtifact[] {
        this.ensureBootstrapped();
        const selectors = new Set(names.map((name) => name.toLowerCase()));
        const domains = detectDomains(goal, names);
        return dedupeHooks(this.listArtifacts().filter((artifact) => {
            if (artifact.rolloutStatus === 'revoked') return false;
            if (trigger && artifact.trigger !== trigger) return false;
            return selectors.has(artifact.name.toLowerCase()) ||
                selectors.has(artifact.hookId.toLowerCase()) ||
                (artifact.domain ? domains.includes(artifact.domain) : false);
        }));
    }

    dispatch(trigger: HookTrigger, hooks: HookArtifact[], context: {
        goal: string;
        allowMutateHooks?: boolean;
        tags?: string[];
    }): HookDispatchResult {
        const selected = hooks.filter((hook) => hook.trigger === trigger && hook.rolloutStatus !== 'revoked');
        const notes: string[] = [];
        const events: Array<Record<string, unknown>> = [];
        const workflowSelectors = new Set<string>();
        const skillSelectors = new Set<string>();
        const toolBindings: RuntimeBinding[] = [];
        let blocked = false;

        for (const hook of selected) {
            const mutateBlocked = hook.riskClass === 'mutate' && !context.allowMutateHooks;
            hook.effectiveness.fired += 1;
            if (mutateBlocked) {
                hook.effectiveness.blocked += 1;
                blocked = true;
                notes.push(`Blocked mutate hook ${hook.name} at ${trigger}.`);
                events.push({
                    type: 'hook.blocked',
                    hookId: hook.hookId,
                    name: hook.name,
                    trigger,
                    reason: 'mutate-hooks-disabled',
                });
                continue;
            }

            hook.workflowSelectors.forEach((selector) => workflowSelectors.add(selector));
            hook.skillSelectors.forEach((selector) => skillSelectors.add(selector));
            toolBindings.push(...hook.toolBindings);
            hook.effectiveness.queued += hook.workflowSelectors.length + hook.skillSelectors.length + hook.toolBindings.length;
            notes.push(`Hook ${hook.name} fired at ${trigger}.`);
            events.push({
                type: 'hook.fired',
                hookId: hook.hookId,
                name: hook.name,
                trigger,
                domain: hook.domain,
                riskClass: hook.riskClass,
            });
            this.persistArtifact(hook);
        }

        return {
            trigger,
            blocked,
            events,
            notes,
            workflowSelectors: [...workflowSelectors],
            skillSelectors: [...skillSelectors],
            toolBindings,
        };
    }

    private stage(artifact: HookArtifact): HookArtifact {
        artifact.validationStatus = this.validate(artifact).valid ? 'validated' : 'rejected';
        this.artifacts.set(artifact.hookId, artifact);
        this.persistArtifact(artifact);
        return artifact;
    }

    private validate(artifact: HookArtifact): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        if (!artifact.name.trim()) errors.push('Hook name is required.');
        if (!artifact.description.trim()) errors.push('Hook description is required.');
        return { valid: errors.length === 0, errors };
    }

    private ensureBootstrapped(): void {
        if (this.bootstrapped) return;
        for (const seed of BUILTIN_HOOKS) {
            this.stage({
                hookId: `hook_${slugify(seed.name)}`,
                version: 1,
                name: seed.name,
                description: seed.description,
                domain: seed.domain,
                trigger: seed.trigger,
                conditions: seed.conditions,
                guardrails: seed.guardrails,
                skillSelectors: seed.skillSelectors ?? [],
                workflowSelectors: seed.workflowSelectors ?? [],
                toolBindings: seed.toolBindings ?? [],
                riskClass: seed.riskClass,
                scope: 'base',
                provenance: 'bundled',
                validationStatus: 'validated',
                rolloutStatus: 'promoted',
                effectiveness: { fired: 0, blocked: 0, queued: 0 },
            });
        }

        const hookDir = path.join(this.workspaceRoot, '.agent', 'hooks');
        for (const entry of readMarkdownArtifacts(hookDir)) {
            const frontmatter = entry.parsed.frontmatter;
            const name = String(frontmatter.name ?? path.basename(entry.path, '.md'));
            this.stage({
                hookId: `hook_local_${slugify(name)}`,
                version: 1,
                name,
                description: String(frontmatter.description ?? 'Local hook'),
                domain: String(frontmatter.domain ?? detectDomains(name)[0] ?? ''),
                trigger: normalizeTrigger(frontmatter.trigger),
                conditions: toStringArray(frontmatter.conditions),
                guardrails: toStringArray(frontmatter.guardrails),
                skillSelectors: toStringArray(frontmatter.skills),
                workflowSelectors: toStringArray(frontmatter.workflows),
                toolBindings: [],
                riskClass: normalizeRiskClass(frontmatter.riskClass),
                scope: 'base',
                provenance: `local:${entry.path}`,
                validationStatus: 'validated',
                rolloutStatus: 'promoted',
                effectiveness: { fired: 0, blocked: 0, queued: 0 },
            });
        }

        this.bootstrapped = true;
    }

    private persistArtifact(artifact: HookArtifact): void {
        const dir = path.join(this.rootDir, artifact.hookId, `v${artifact.version}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'artifact.json'), JSON.stringify(artifact, null, 2), 'utf8');
    }
}

function normalizeRiskClass(value: unknown): SkillRiskClass {
    return value === 'mutate' || value === 'orchestrate' ? value : 'read';
}

function normalizeTrigger(value: unknown): HookTrigger {
    const candidate = String(value ?? 'run.created') as HookTrigger;
    const valid: HookTrigger[] = [
        'run.created',
        'before-read',
        'before-mutate',
        'before-verify',
        'retry',
        'run.failed',
        'run.verified',
        'promotion.approved',
        'memory.stored',
        'shield.blocked',
    ];
    return valid.includes(candidate) ? candidate : 'run.created';
}

function toStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function dedupeHooks(artifacts: HookArtifact[]): HookArtifact[] {
    const seen = new Set<string>();
    return artifacts.filter((artifact) => {
        const key = artifact.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export const createHookRuntime = (rootDir?: string, workspaceRoot?: string) =>
    new HookRuntime(rootDir, workspaceRoot);
