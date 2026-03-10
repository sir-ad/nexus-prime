import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
    detectDomains,
    readMarkdownArtifacts,
    slugify,
    type AutomationTriggerMode,
    type ConnectorKind,
    type HookTrigger,
    type SkillScope,
} from './runtime-assets.js';

export interface ConnectorBinding {
    kind: ConnectorKind;
    target: string;
    method?: 'POST' | 'PUT';
    eventName?: string;
}

export interface ConnectorDeliveryRecord {
    kind: ConnectorKind;
    target: string;
    status: 'queued' | 'delivered' | 'failed';
    responseCode?: number;
    message: string;
}

export interface AutomationArtifact {
    automationId: string;
    version: number;
    name: string;
    description: string;
    domain?: string;
    triggerMode: AutomationTriggerMode;
    eventTrigger?: HookTrigger;
    schedule?: string;
    connectorEvent?: string;
    workflowSelectors: string[];
    hookSelectors: string[];
    skillSelectors: string[];
    connectors: ConnectorBinding[];
    scope: SkillScope;
    provenance: string;
    validationStatus: 'pending' | 'validated' | 'rejected';
    rolloutStatus: 'staged' | 'hot' | 'promoted' | 'revoked';
    effectiveness: {
        queuedRuns: number;
        deliveries: number;
        failures: number;
    };
}

export interface AutomationDispatch {
    trigger: HookTrigger;
    automationId: string;
    name: string;
    queuedRun?: {
        goal: string;
        workflowSelectors: string[];
        skillSelectors: string[];
        hookSelectors: string[];
    };
    deliveries: ConnectorDeliveryRecord[];
}

interface AutomationSeed {
    name: string;
    description: string;
    domain?: string;
    triggerMode: AutomationTriggerMode;
    eventTrigger?: HookTrigger;
    workflowSelectors: string[];
    hookSelectors?: string[];
    skillSelectors?: string[];
}

const BUILTIN_AUTOMATIONS: AutomationSeed[] = [
    {
        name: 'verified-followup-automation',
        description: 'Queue a bounded approval workflow after a verified run.',
        domain: 'workflows',
        triggerMode: 'event',
        eventTrigger: 'run.verified',
        workflowSelectors: ['workflows-approval-loop'],
    },
    {
        name: 'failure-recovery-automation',
        description: 'Queue retry and review workflows after a failed run.',
        domain: 'orchestration',
        triggerMode: 'event',
        eventTrigger: 'run.failed',
        workflowSelectors: ['workflows-execution-loop'],
        hookSelectors: ['retry-narrow-scope'],
        skillSelectors: ['orchestration-playbook'],
    },
    {
        name: 'memory-governance-automation',
        description: 'Attach memory and security review after memory storage events.',
        domain: 'security',
        triggerMode: 'event',
        eventTrigger: 'memory.stored',
        workflowSelectors: ['security-approval-loop'],
        hookSelectors: ['memory-shield-escalation'],
        skillSelectors: ['security-reviewer'],
    },
];

export class AutomationRuntime {
    private rootDir: string;
    private workspaceRoot: string;
    private artifacts = new Map<string, AutomationArtifact>();
    private bootstrapped = false;

    constructor(rootDir?: string, workspaceRoot?: string) {
        this.rootDir = rootDir ?? path.join(os.tmpdir(), 'nexus-prime-runtime-automations');
        this.workspaceRoot = workspaceRoot ?? process.cwd();
        fs.mkdirSync(this.rootDir, { recursive: true });
        this.ensureBootstrapped();
    }

    listArtifacts(): AutomationArtifact[] {
        this.ensureBootstrapped();
        return [...this.artifacts.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    getArtifact(automationId: string): AutomationArtifact | undefined {
        this.ensureBootstrapped();
        return this.artifacts.get(automationId);
    }

    findByName(name: string): AutomationArtifact | undefined {
        this.ensureBootstrapped();
        const normalized = name.toLowerCase();
        return this.listArtifacts().find((artifact) =>
            artifact.name.toLowerCase() === normalized || artifact.automationId.toLowerCase() === normalized
        );
    }

    createAutomation(input: Omit<AutomationArtifact, 'automationId' | 'version' | 'validationStatus' | 'rolloutStatus' | 'effectiveness'>): AutomationArtifact {
        const artifact: AutomationArtifact = {
            ...input,
            automationId: `automation_${randomUUID().slice(0, 8)}`,
            version: 1,
            validationStatus: 'pending',
            rolloutStatus: 'staged',
            effectiveness: { queuedRuns: 0, deliveries: 0, failures: 0 },
        };
        return this.stage(artifact);
    }

    deploy(automationId: string, scope: SkillScope = 'session'): AutomationArtifact | undefined {
        const artifact = this.artifacts.get(automationId);
        if (!artifact) return undefined;
        artifact.scope = scope;
        artifact.rolloutStatus = scope === 'global' ? 'promoted' : 'hot';
        this.persistArtifact(artifact);
        return artifact;
    }

    revoke(automationId: string): AutomationArtifact | undefined {
        const artifact = this.artifacts.get(automationId);
        if (!artifact) return undefined;
        artifact.rolloutStatus = 'revoked';
        this.persistArtifact(artifact);
        return artifact;
    }

    resolveAutomationSelectors(names: string[], goal: string, triggerMode?: AutomationTriggerMode): AutomationArtifact[] {
        this.ensureBootstrapped();
        const selectors = new Set(names.map((name) => name.toLowerCase()));
        const domains = detectDomains(goal, names);
        return dedupeAutomations(this.listArtifacts().filter((artifact) => {
            if (artifact.rolloutStatus === 'revoked') return false;
            if (triggerMode && artifact.triggerMode !== triggerMode) return false;
            return selectors.has(artifact.name.toLowerCase()) ||
                selectors.has(artifact.automationId.toLowerCase()) ||
                (artifact.domain ? domains.includes(artifact.domain) : false);
        }));
    }

    async dispatch(trigger: HookTrigger, automations: AutomationArtifact[], context: {
        goal: string;
        executeConnectors?: boolean;
        payload?: Record<string, unknown>;
    }): Promise<AutomationDispatch[]> {
        const selected = automations.filter((artifact) =>
            artifact.triggerMode === 'event' &&
            artifact.eventTrigger === trigger &&
            artifact.rolloutStatus !== 'revoked'
        );

        const dispatches: AutomationDispatch[] = [];
        for (const artifact of selected) {
            const deliveries = await this.deliverConnectors(artifact, context.executeConnectors ?? false, context.payload ?? {});
            const queuedRun = artifact.workflowSelectors.length > 0 || artifact.skillSelectors.length > 0 || artifact.hookSelectors.length > 0
                ? {
                    goal: `${artifact.description} for ${context.goal}`,
                    workflowSelectors: artifact.workflowSelectors,
                    skillSelectors: artifact.skillSelectors,
                    hookSelectors: artifact.hookSelectors,
                }
                : undefined;

            artifact.effectiveness.queuedRuns += queuedRun ? 1 : 0;
            artifact.effectiveness.deliveries += deliveries.filter((delivery) => delivery.status === 'delivered').length;
            artifact.effectiveness.failures += deliveries.filter((delivery) => delivery.status === 'failed').length;
            this.persistArtifact(artifact);

            dispatches.push({
                trigger,
                automationId: artifact.automationId,
                name: artifact.name,
                queuedRun,
                deliveries,
            });
        }

        return dispatches;
    }

    private stage(artifact: AutomationArtifact): AutomationArtifact {
        artifact.validationStatus = this.validate(artifact).valid ? 'validated' : 'rejected';
        this.artifacts.set(artifact.automationId, artifact);
        this.persistArtifact(artifact);
        return artifact;
    }

    private validate(artifact: AutomationArtifact): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        if (!artifact.name.trim()) errors.push('Automation name is required.');
        if (!artifact.description.trim()) errors.push('Automation description is required.');
        return { valid: errors.length === 0, errors };
    }

    private async deliverConnectors(
        artifact: AutomationArtifact,
        executeConnectors: boolean,
        payload: Record<string, unknown>
    ): Promise<ConnectorDeliveryRecord[]> {
        const deliveries: ConnectorDeliveryRecord[] = [];
        for (const connector of artifact.connectors) {
            if (!executeConnectors || !connector.target) {
                deliveries.push({
                    kind: connector.kind,
                    target: connector.target,
                    status: 'queued',
                    message: 'Connector queued for bounded delivery.',
                });
                continue;
            }

            try {
                const response = await fetch(connector.target, {
                    method: connector.method ?? 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        automationId: artifact.automationId,
                        automationName: artifact.name,
                        eventName: connector.eventName ?? artifact.eventTrigger,
                        payload,
                    }),
                });
                deliveries.push({
                    kind: connector.kind,
                    target: connector.target,
                    status: response.ok ? 'delivered' : 'failed',
                    responseCode: response.status,
                    message: response.ok ? 'Connector delivered successfully.' : `Connector failed with ${response.status}.`,
                });
            } catch (error: any) {
                deliveries.push({
                    kind: connector.kind,
                    target: connector.target,
                    status: 'failed',
                    message: String(error?.message ?? error),
                });
            }
        }

        return deliveries;
    }

    private ensureBootstrapped(): void {
        if (this.bootstrapped) return;
        for (const seed of BUILTIN_AUTOMATIONS) {
            this.stage({
                automationId: `automation_${slugify(seed.name)}`,
                version: 1,
                name: seed.name,
                description: seed.description,
                domain: seed.domain,
                triggerMode: seed.triggerMode,
                eventTrigger: seed.eventTrigger,
                workflowSelectors: seed.workflowSelectors,
                hookSelectors: seed.hookSelectors ?? [],
                skillSelectors: seed.skillSelectors ?? [],
                connectors: [],
                scope: 'base',
                provenance: 'bundled',
                validationStatus: 'validated',
                rolloutStatus: 'promoted',
                effectiveness: { queuedRuns: 0, deliveries: 0, failures: 0 },
            });
        }

        const automationDir = path.join(this.workspaceRoot, '.agent', 'automations');
        for (const entry of readMarkdownArtifacts(automationDir)) {
            const frontmatter = entry.parsed.frontmatter;
            const name = String(frontmatter.name ?? path.basename(entry.path, '.md'));
            this.stage({
                automationId: `automation_local_${slugify(name)}`,
                version: 1,
                name,
                description: String(frontmatter.description ?? 'Local automation'),
                domain: String(frontmatter.domain ?? detectDomains(name)[0] ?? ''),
                triggerMode: normalizeTriggerMode(frontmatter.triggerMode),
                eventTrigger: normalizeEventTrigger(frontmatter.eventTrigger),
                schedule: String(frontmatter.schedule ?? ''),
                connectorEvent: String(frontmatter.connectorEvent ?? ''),
                workflowSelectors: toStringArray(frontmatter.workflows),
                hookSelectors: toStringArray(frontmatter.hooks),
                skillSelectors: toStringArray(frontmatter.skills),
                connectors: [],
                scope: 'base',
                provenance: `local:${entry.path}`,
                validationStatus: 'validated',
                rolloutStatus: 'promoted',
                effectiveness: { queuedRuns: 0, deliveries: 0, failures: 0 },
            });
        }

        this.bootstrapped = true;
    }

    private persistArtifact(artifact: AutomationArtifact): void {
        const dir = path.join(this.rootDir, artifact.automationId, `v${artifact.version}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'artifact.json'), JSON.stringify(artifact, null, 2), 'utf8');
    }
}

function normalizeTriggerMode(value: unknown): AutomationTriggerMode {
    return value === 'schedule' || value === 'connector' ? value : 'event';
}

function normalizeEventTrigger(value: unknown): HookTrigger | undefined {
    const candidate = String(value ?? '');
    if (!candidate) return undefined;
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
    return valid.includes(candidate as HookTrigger) ? (candidate as HookTrigger) : undefined;
}

function toStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function dedupeAutomations(artifacts: AutomationArtifact[]): AutomationArtifact[] {
    const seen = new Set<string>();
    return artifacts.filter((artifact) => {
        const key = artifact.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export const createAutomationRuntime = (rootDir?: string, workspaceRoot?: string) =>
    new AutomationRuntime(rootDir, workspaceRoot);
