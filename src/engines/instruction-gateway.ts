import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { MemoryStats } from './memory.js';
import type { RuntimePrimaryClientSnapshot, RuntimeFederationUsageSnapshot } from './runtime-registry.js';
import { resolveNexusStateDir } from './runtime-registry.js';
import type { SelectedCrew, SelectedSpecialist } from './specialist-roster.js';
import type { SkillArtifact } from './skill-runtime.js';
import type { WorkflowArtifact } from './workflow-runtime.js';
import type { HookArtifact } from './hook-runtime.js';
import type { AutomationArtifact } from './automation-runtime.js';

export type OrchestrationExecutionMode = 'autonomous' | 'manual-low-level';
export type ExecutionLedgerStepStatus = 'pending' | 'completed' | 'skipped' | 'blocked' | 'failed';
export type ExecutionLedgerStepId =
    | 'identify-client-session'
    | 'recall-memory'
    | 'memory-stats'
    | 'planner-selection'
    | 'catalog-shortlist'
    | 'candidate-file-discovery'
    | 'token-optimization'
    | 'governance-preflight'
    | 'compile-instruction-packet'
    | 'runtime-execution'
    | 'structured-learning';

export interface ExecutionLedgerStep {
    id: ExecutionLedgerStepId;
    label: string;
    status: ExecutionLedgerStepStatus;
    updatedAt: number;
    reason?: string;
    summary?: string;
    details?: Record<string, unknown>;
}

export interface ExecutionLedger {
    sessionId: string;
    runId?: string;
    task: string;
    executionMode: OrchestrationExecutionMode;
    clientId?: string;
    clientFamily?: string;
    plannerApplied: boolean;
    tokenOptimizationApplied: boolean;
    steps: ExecutionLedgerStep[];
    packetHash?: string;
    lastUpdatedAt: number;
}

export interface PacketSelection {
    id: string;
    name: string;
    summary?: string;
}

export interface TokenPolicySnapshot {
    applied: boolean;
    reason: string;
    candidateFiles: string[];
    selectedFiles: string[];
    estimatedSavings: number;
    estimatedCompressionPct: number;
}

export interface GovernanceSnapshot {
    passed: boolean;
    score: number;
    violations: string[];
    suggestions: string[];
}

export interface InstructionPacket {
    session: {
        runtimeId: string;
        sessionId: string;
        objectiveHistory: string[];
        phases: string[];
    };
    client?: {
        clientId: string;
        family: string;
        displayName: string;
        state: string;
        source: string;
    };
    task: {
        goal: string;
        executionMode: OrchestrationExecutionMode;
        manualOverrides: string[];
    };
    operatingRule: string;
    requiredSequence: string[];
    selectedCrew?: PacketSelection;
    selectedSpecialists: PacketSelection[];
    selectedSkills: PacketSelection[];
    selectedWorkflows: PacketSelection[];
    selectedHooks: PacketSelection[];
    selectedAutomations: PacketSelection[];
    governance: GovernanceSnapshot;
    federation: {
        activePeerLinks: number;
        knownPeers: number;
        tracesPublished: number;
        relayConfigured: boolean;
        relayMode: string;
        relayLastError?: string;
    };
    tokenPolicy: TokenPolicySnapshot;
    memoryContext: {
        matches: string[];
        stats?: Pick<MemoryStats, 'prefrontal' | 'hippocampus' | 'cortex' | 'totalLinks'>;
    };
    manualOverrides: string[];
    catalogShortlist: {
        skills: string[];
        workflows: string[];
        hooks: string[];
        automations: string[];
        specialists: string[];
        crews: string[];
    };
    protocol: {
        sources: string[];
        sections: Array<{ source: string; heading: string; content: string }>;
        markdown: string;
    };
    estimatedTokens: number;
    packetHash: string;
}

export interface ClientInstructionEnvelope {
    clientFamily: string;
    format: 'markdown' | 'skill-md' | 'mdc' | 'windsurfrules';
    packetHash: string;
    content: string;
}

export interface PacketCompileInput {
    runtimeId: string;
    sessionId: string;
    goal: string;
    executionMode: OrchestrationExecutionMode;
    manualOverrides?: string[];
    objectiveHistory?: string[];
    phases?: string[];
    requiredSequence?: string[];
    client?: RuntimePrimaryClientSnapshot;
    selectedCrew?: SelectedCrew;
    selectedSpecialists?: SelectedSpecialist[];
    selectedSkills?: SkillArtifact[];
    selectedWorkflows?: WorkflowArtifact[];
    selectedHooks?: HookArtifact[];
    selectedAutomations?: AutomationArtifact[];
    catalogShortlist?: Partial<InstructionPacket['catalogShortlist']>;
    governance?: GovernanceSnapshot;
    federation?: RuntimeFederationUsageSnapshot;
    tokenPolicy?: Partial<TokenPolicySnapshot>;
    memoryMatches?: string[];
    memoryStats?: MemoryStats;
}

interface ProtocolSection {
    source: string;
    heading: string;
    content: string;
    estimatedTokens: number;
    priority: number;
    hash: string;
}

export const PACKET_TOKEN_LIMIT = 3500;
export const DEFAULT_REQUIRED_SEQUENCE: string[] = [
    'identify-client-session',
    'recall-memory',
    'memory-stats',
    'planner-selection',
    'catalog-shortlist',
    'candidate-file-discovery',
    'token-optimization',
    'governance-preflight',
    'compile-instruction-packet',
    'runtime-execution',
    'structured-learning',
];

const LEDGER_STEP_LABELS: Record<ExecutionLedgerStepId, string> = {
    'identify-client-session': 'Identify client and session',
    'recall-memory': 'Recall relevant memory',
    'memory-stats': 'Inspect memory stats',
    'planner-selection': 'Run planner selection',
    'catalog-shortlist': 'Build catalog shortlist',
    'candidate-file-discovery': 'Discover candidate files',
    'token-optimization': 'Apply token optimization',
    'governance-preflight': 'Run governance preflight',
    'compile-instruction-packet': 'Compile instruction packet',
    'runtime-execution': 'Execute runtime',
    'structured-learning': 'Store structured learning',
};

const PROTOCOL_SOURCES = [
    { source: 'AGENTS.md', relativePath: 'AGENTS.md' },
    { source: '.agent/rules/core-rules.md', relativePath: path.join('.agent', 'rules', 'core-rules.md') },
    { source: '.agent/rules/quality-gates.md', relativePath: path.join('.agent', 'rules', 'quality-gates.md') },
    { source: '.agent/rules/agent-guardrails.md', relativePath: path.join('.agent', 'rules', 'agent-guardrails.md') },
];

export function estimateInstructionTokens(value: string): number {
    return Math.max(1, Math.ceil(String(value || '').length / 4));
}

export function createExecutionLedger(input: {
    sessionId: string;
    task: string;
    executionMode: OrchestrationExecutionMode;
    clientId?: string;
    clientFamily?: string;
}): ExecutionLedger {
    const now = Date.now();
    return {
        sessionId: input.sessionId,
        task: input.task,
        executionMode: input.executionMode,
        clientId: input.clientId,
        clientFamily: input.clientFamily,
        plannerApplied: false,
        tokenOptimizationApplied: false,
        lastUpdatedAt: now,
        steps: DEFAULT_REQUIRED_SEQUENCE.map((id) => ({
            id: id as ExecutionLedgerStepId,
            label: LEDGER_STEP_LABELS[id as ExecutionLedgerStepId],
            status: 'pending',
            updatedAt: now,
        })),
    };
}

export function markExecutionLedgerStep(
    ledger: ExecutionLedger,
    stepId: ExecutionLedgerStepId,
    status: ExecutionLedgerStepStatus,
    patch: {
        reason?: string;
        summary?: string;
        details?: Record<string, unknown>;
    } = {},
): ExecutionLedger {
    const now = Date.now();
    const step = ledger.steps.find((entry) => entry.id === stepId);
    if (!step) {
        ledger.steps.push({
            id: stepId,
            label: LEDGER_STEP_LABELS[stepId],
            status,
            updatedAt: now,
            ...patch,
        });
    } else {
        step.status = status;
        step.updatedAt = now;
        step.reason = patch.reason ?? step.reason;
        step.summary = patch.summary ?? step.summary;
        step.details = patch.details ?? step.details;
    }
    if (stepId === 'planner-selection' && status === 'completed') {
        ledger.plannerApplied = true;
    }
    if (stepId === 'token-optimization' && status === 'completed') {
        ledger.tokenOptimizationApplied = true;
    }
    ledger.lastUpdatedAt = now;
    return ledger;
}

function renderSelection(summary: { id?: string; name?: string; summary?: string }): PacketSelection | undefined {
    if (!summary.id && !summary.name) return undefined;
    return {
        id: String(summary.id ?? summary.name ?? ''),
        name: String(summary.name ?? summary.id ?? ''),
        summary: summary.summary,
    };
}

function normalizeSelectionList(values: Array<Record<string, unknown>>, summaryField: string): PacketSelection[] {
    return values.map((value) => ({
        id: String(value.skillId ?? value.workflowId ?? value.hookId ?? value.automationId ?? value.specialistId ?? value.crewId ?? value.name ?? ''),
        name: String(value.name ?? value.specialistName ?? value.crewName ?? value.skillId ?? value.workflowId ?? value.hookId ?? value.automationId ?? value.specialistId ?? ''),
        summary: summaryField && typeof value[summaryField] === 'string' ? String(value[summaryField]) : undefined,
    }));
}

function normalizeHeading(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hashValue(value: string): string {
    return createHash('sha1').update(value).digest('hex');
}

function sectionPriority(source: string, heading: string): number {
    const normalized = normalizeHeading(`${source} ${heading}`);
    if (normalized.includes('default operating rule')) return 0;
    if (normalized.includes('context acquisition order')) return 1;
    if (normalized.includes('before reading files')) return 2;
    if (normalized.includes('before risky operations')) return 3;
    if (normalized.includes('anti patterns')) return 4;
    if (normalized.includes('quality gate')) return 5;
    if (normalized.includes('guardrail')) return 6;
    if (normalized.includes('memory')) return 7;
    return 20;
}

function splitMarkdownSections(source: string, markdown: string): ProtocolSection[] {
    const lines = markdown.split('\n');
    const sections: Array<{ heading: string; lines: string[] }> = [];
    let current = { heading: source, lines: [] as string[] };

    for (const line of lines) {
        if (/^#{1,6}\s+/.test(line)) {
            if (current.lines.length > 0) sections.push(current);
            current = { heading: line.replace(/^#{1,6}\s+/, '').trim(), lines: [] };
            continue;
        }
        current.lines.push(line);
    }
    if (current.lines.length > 0) sections.push(current);

    return sections
        .map((section) => {
            const content = section.lines.join('\n').trim();
            const signature = `${normalizeHeading(section.heading)}\n${content}`;
            return {
                source,
                heading: section.heading,
                content,
                estimatedTokens: estimateInstructionTokens(content),
                priority: sectionPriority(source, section.heading),
                hash: hashValue(signature),
            };
        })
        .filter((section) => section.content.length > 0);
}

function truncateSection(section: ProtocolSection, maxTokens: number): ProtocolSection | undefined {
    if (section.estimatedTokens <= maxTokens) return section;
    if (maxTokens < 48) return undefined;
    const maxChars = Math.max(160, maxTokens * 4);
    return {
        ...section,
        content: `${section.content.slice(0, maxChars).trim()}\n\n[truncated to fit packet budget]`,
        estimatedTokens: estimateInstructionTokens(section.content.slice(0, maxChars)),
        hash: hashValue(`${section.heading}:${section.content.slice(0, maxChars)}`),
    };
}

export class InstructionGateway {
    private readonly repoRoot: string;
    private readonly packetsDir: string;

    constructor(repoRoot: string = process.cwd(), stateRoot: string = resolveNexusStateDir()) {
        this.repoRoot = repoRoot;
        this.packetsDir = path.join(stateRoot, 'instruction-packets');
        fs.mkdirSync(this.packetsDir, { recursive: true });
    }

    compile(input: PacketCompileInput): InstructionPacket {
        const protocolSections = this.selectProtocolSections(input);
        const packet: InstructionPacket = {
            session: {
                runtimeId: input.runtimeId,
                sessionId: input.sessionId,
                objectiveHistory: (input.objectiveHistory ?? []).slice(0, 8),
                phases: input.phases ?? [],
            },
            client: input.client ? {
                clientId: input.client.clientId,
                family: this.toClientFamily(input.client.clientId),
                displayName: input.client.displayName,
                state: input.client.state,
                source: input.client.source,
            } : undefined,
            task: {
                goal: input.goal,
                executionMode: input.executionMode,
                manualOverrides: dedupeStrings(input.manualOverrides ?? []),
            },
            operatingRule: 'Treat Nexus Prime as an orchestrator-first control plane. Use the compiled packet, not raw repo-wide docs, as the execution brief.',
            requiredSequence: input.requiredSequence ?? DEFAULT_REQUIRED_SEQUENCE,
            selectedCrew: renderSelection({
                id: input.selectedCrew?.crewId,
                name: input.selectedCrew?.name,
                summary: input.selectedCrew?.summary,
            }),
            selectedSpecialists: normalizeSelectionList((input.selectedSpecialists ?? []) as unknown as Array<Record<string, unknown>>, 'mission'),
            selectedSkills: normalizeSelectionList((input.selectedSkills ?? []) as unknown as Array<Record<string, unknown>>, 'instructions'),
            selectedWorkflows: normalizeSelectionList((input.selectedWorkflows ?? []) as unknown as Array<Record<string, unknown>>, 'description'),
            selectedHooks: normalizeSelectionList((input.selectedHooks ?? []) as unknown as Array<Record<string, unknown>>, 'description'),
            selectedAutomations: normalizeSelectionList((input.selectedAutomations ?? []) as unknown as Array<Record<string, unknown>>, 'description'),
            governance: {
                passed: input.governance?.passed ?? true,
                score: input.governance?.score ?? 0,
                violations: input.governance?.violations ?? [],
                suggestions: input.governance?.suggestions ?? [],
            },
            federation: {
                activePeerLinks: Number(input.federation?.activePeerLinks ?? 0),
                knownPeers: Number(input.federation?.knownPeers ?? 0),
                tracesPublished: Number(input.federation?.tracesPublished ?? 0),
                relayConfigured: Boolean(input.federation?.relay.configured),
                relayMode: input.federation?.relay.mode ?? 'degraded',
                relayLastError: input.federation?.relay.lastError,
            },
            tokenPolicy: {
                applied: Boolean(input.tokenPolicy?.applied),
                reason: input.tokenPolicy?.reason ?? 'No token policy recorded.',
                candidateFiles: (input.tokenPolicy?.candidateFiles ?? []).slice(0, 16),
                selectedFiles: (input.tokenPolicy?.selectedFiles ?? []).slice(0, 16),
                estimatedSavings: Number(input.tokenPolicy?.estimatedSavings ?? 0),
                estimatedCompressionPct: Number(input.tokenPolicy?.estimatedCompressionPct ?? 0),
            },
            memoryContext: {
                matches: (input.memoryMatches ?? []).slice(0, 6),
                stats: input.memoryStats ? {
                    prefrontal: input.memoryStats.prefrontal,
                    hippocampus: input.memoryStats.hippocampus,
                    cortex: input.memoryStats.cortex,
                    totalLinks: input.memoryStats.totalLinks,
                } : undefined,
            },
            manualOverrides: dedupeStrings(input.manualOverrides ?? []),
            catalogShortlist: {
                skills: dedupeStrings(input.catalogShortlist?.skills ?? []).slice(0, 4),
                workflows: dedupeStrings(input.catalogShortlist?.workflows ?? []).slice(0, 4),
                hooks: dedupeStrings(input.catalogShortlist?.hooks ?? []).slice(0, 3),
                automations: dedupeStrings(input.catalogShortlist?.automations ?? []).slice(0, 3),
                specialists: dedupeStrings(input.catalogShortlist?.specialists ?? []).slice(0, 6),
                crews: dedupeStrings(input.catalogShortlist?.crews ?? []).slice(0, 3),
            },
            protocol: {
                sources: PROTOCOL_SOURCES.map((entry) => entry.source),
                sections: protocolSections.map((section) => ({
                    source: section.source,
                    heading: section.heading,
                    content: section.content,
                })),
                markdown: protocolSections
                    .map((section) => `## ${section.heading}\n${section.content}`)
                    .join('\n\n')
                    .trim(),
            },
            estimatedTokens: 0,
            packetHash: '',
        };

        const unsigned = {
            ...packet,
            estimatedTokens: undefined,
            packetHash: undefined,
        };
        const estimatedTokens = estimateInstructionTokens(JSON.stringify(unsigned));
        const packetHash = hashValue(JSON.stringify(unsigned));
        return {
            ...packet,
            estimatedTokens,
            packetHash,
        };
    }

    persist(packet: InstructionPacket, repoRoot: string = this.repoRoot): { stateJsonPath: string; stateMarkdownPath: string; workspaceJsonPath?: string; workspaceMarkdownPath?: string } {
        const runtimeDir = path.join(this.packetsDir, packet.session.runtimeId);
        fs.mkdirSync(runtimeDir, { recursive: true });
        const stateJsonPath = path.join(runtimeDir, 'packet.json');
        const stateMarkdownPath = path.join(runtimeDir, 'packet.md');
        fs.writeFileSync(stateJsonPath, JSON.stringify(packet, null, 2), 'utf8');
        fs.writeFileSync(stateMarkdownPath, renderInstructionPacketMarkdown(packet), 'utf8');

        let workspaceJsonPath: string | undefined;
        let workspaceMarkdownPath: string | undefined;
        if (repoRoot) {
            const workspaceRuntimeDir = path.join(repoRoot, '.agent', 'runtime');
            fs.mkdirSync(workspaceRuntimeDir, { recursive: true });
            workspaceJsonPath = path.join(workspaceRuntimeDir, 'packet.json');
            workspaceMarkdownPath = path.join(workspaceRuntimeDir, 'packet.md');
            fs.writeFileSync(workspaceJsonPath, JSON.stringify(packet, null, 2), 'utf8');
            fs.writeFileSync(workspaceMarkdownPath, renderInstructionPacketMarkdown(packet), 'utf8');
        }

        return { stateJsonPath, stateMarkdownPath, workspaceJsonPath, workspaceMarkdownPath };
    }

    renderEnvelope(packet: InstructionPacket, clientId?: string): ClientInstructionEnvelope {
        const family = this.toClientFamily(clientId ?? packet.client?.clientId);
        const markdown = renderInstructionPacketMarkdown(packet);
        if (family === 'antigravity') {
            return {
                clientFamily: family,
                format: 'skill-md',
                packetHash: packet.packetHash,
                content: `# Nexus Prime Runtime Packet\n\n${markdown}`,
            };
        }
        if (family === 'cursor') {
            return {
                clientFamily: family,
                format: 'mdc',
                packetHash: packet.packetHash,
                content: `---\ndescription: Nexus Prime compiled instruction packet\nalwaysApply: true\n---\n\n${markdown}`,
            };
        }
        if (family === 'windsurf') {
            return {
                clientFamily: family,
                format: 'windsurfrules',
                packetHash: packet.packetHash,
                content: `# Nexus Prime Packet (${packet.packetHash})\n\n${markdown}`,
            };
        }
        return {
            clientFamily: family,
            format: 'markdown',
            packetHash: packet.packetHash,
            content: markdown,
        };
    }

    private selectProtocolSections(input: PacketCompileInput): ProtocolSection[] {
        const allSections: ProtocolSection[] = [];
        const seen = new Set<string>();

        for (const source of PROTOCOL_SOURCES) {
            const target = path.join(this.repoRoot, source.relativePath);
            if (!fs.existsSync(target)) continue;
            const markdown = fs.readFileSync(target, 'utf8');
            for (const section of splitMarkdownSections(source.source, markdown)) {
                const key = `${normalizeHeading(section.heading)}:${section.hash}`;
                if (seen.has(key)) continue;
                seen.add(key);
                allSections.push(section);
            }
        }

        allSections.sort((left, right) => left.priority - right.priority
            || left.source.localeCompare(right.source)
            || left.heading.localeCompare(right.heading));

        const baseOverhead = estimateInstructionTokens(JSON.stringify({
            goal: input.goal,
            selectedSkills: input.selectedSkills?.map((skill) => skill.name),
            selectedWorkflows: input.selectedWorkflows?.map((workflow) => workflow.name),
            selectedHooks: input.selectedHooks?.map((hook) => hook.name),
            selectedAutomations: input.selectedAutomations?.map((automation) => automation.name),
            selectedSpecialists: input.selectedSpecialists?.map((specialist) => specialist.name),
            manualOverrides: input.manualOverrides ?? [],
            memoryMatches: input.memoryMatches ?? [],
        }));
        let remaining = Math.max(320, PACKET_TOKEN_LIMIT - baseOverhead);
        const selected: ProtocolSection[] = [];

        for (const section of allSections) {
            if (remaining <= 0) break;
            const next = truncateSection(section, remaining);
            if (!next) continue;
            selected.push(next);
            remaining -= next.estimatedTokens;
        }

        return selected;
    }

    private toClientFamily(clientId?: string): string {
        const normalized = String(clientId ?? 'codex').toLowerCase();
        if (normalized === 'openclaw' || normalized === 'antigravity') return 'antigravity';
        if (normalized === 'claude-code') return 'claude-code';
        if (normalized === 'opencode') return 'opencode';
        if (normalized === 'cursor') return 'cursor';
        if (normalized === 'windsurf') return 'windsurf';
        if (normalized === 'mcp') return 'mcp';
        return normalized || 'codex';
    }
}

export function renderInstructionPacketMarkdown(packet: InstructionPacket): string {
    const lines = [
        `# Nexus Prime Instruction Packet`,
        ``,
        `- Packet Hash: ${packet.packetHash}`,
        `- Runtime: ${packet.session.runtimeId}`,
        `- Session: ${packet.session.sessionId}`,
        `- Client: ${packet.client?.displayName ?? 'unknown'}`,
        `- Mode: ${packet.task.executionMode}`,
        ``,
        `## Task`,
        packet.task.goal,
        ``,
        `## Operating Rule`,
        packet.operatingRule,
        ``,
        `## Required Sequence`,
        ...packet.requiredSequence.map((step) => `- ${step}`),
        ``,
        `## Selected Assets`,
        packet.selectedCrew ? `- Crew: ${packet.selectedCrew.name}` : `- Crew: none`,
        `- Specialists: ${packet.selectedSpecialists.map((item) => item.name).join(', ') || 'none'}`,
        `- Skills: ${packet.selectedSkills.map((item) => item.name).join(', ') || 'none'}`,
        `- Workflows: ${packet.selectedWorkflows.map((item) => item.name).join(', ') || 'none'}`,
        `- Hooks: ${packet.selectedHooks.map((item) => item.name).join(', ') || 'none'}`,
        `- Automations: ${packet.selectedAutomations.map((item) => item.name).join(', ') || 'none'}`,
        ``,
        `## Token Policy`,
        `- Applied: ${packet.tokenPolicy.applied}`,
        `- Reason: ${packet.tokenPolicy.reason}`,
        `- Candidate Files: ${packet.tokenPolicy.candidateFiles.join(', ') || 'none'}`,
        `- Selected Files: ${packet.tokenPolicy.selectedFiles.join(', ') || 'none'}`,
        `- Estimated Savings: ${packet.tokenPolicy.estimatedSavings}`,
        `- Estimated Compression: ${packet.tokenPolicy.estimatedCompressionPct}%`,
        ``,
        `## Governance`,
        `- Passed: ${packet.governance.passed}`,
        `- Score: ${packet.governance.score}`,
        `- Violations: ${packet.governance.violations.join(', ') || 'none'}`,
        `- Suggestions: ${packet.governance.suggestions.join(', ') || 'none'}`,
        ``,
        `## Federation`,
        `- Active Links: ${packet.federation.activePeerLinks}`,
        `- Known Peers: ${packet.federation.knownPeers}`,
        `- Relay Configured: ${packet.federation.relayConfigured}`,
        `- Relay Mode: ${packet.federation.relayMode}`,
        packet.federation.relayLastError ? `- Relay Error: ${packet.federation.relayLastError}` : `- Relay Error: none`,
        ``,
        `## Memory Context`,
        `- Matches: ${packet.memoryContext.matches.length}`,
        ...packet.memoryContext.matches.map((match) => `- ${match}`),
        ``,
        `## Manual Overrides`,
        ...((packet.manualOverrides.length > 0 ? packet.manualOverrides : ['none']).map((override) => `- ${override}`)),
        ``,
        `## Catalog Shortlist`,
        `- Skills: ${packet.catalogShortlist.skills.join(', ') || 'none'}`,
        `- Workflows: ${packet.catalogShortlist.workflows.join(', ') || 'none'}`,
        `- Hooks: ${packet.catalogShortlist.hooks.join(', ') || 'none'}`,
        `- Automations: ${packet.catalogShortlist.automations.join(', ') || 'none'}`,
        `- Specialists: ${packet.catalogShortlist.specialists.join(', ') || 'none'}`,
        `- Crews: ${packet.catalogShortlist.crews.join(', ') || 'none'}`,
        ``,
        `## Protocol`,
        packet.protocol.markdown || 'No protocol sections loaded.',
    ];
    return lines.join('\n').trim();
}

function dedupeStrings(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}
