import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillRuntime } from './skill-runtime.js';
import { WorkflowRuntime } from './workflow-runtime.js';
import { HookRuntime } from './hook-runtime.js';
import { AutomationRuntime } from './automation-runtime.js';
import { listCrewTemplates, listSpecialists } from './specialist-roster.js';

export interface FeatureRegistryItem {
    name: string;
    surface: string;
    purpose: string;
    notes: string;
}

export interface FeatureRegistrySection {
    id: string;
    title: string;
    summary: string;
    items: FeatureRegistryItem[];
}

export interface FeatureRegistryDocument {
    generatedAt: string;
    generatedFor: string;
    counts: Record<string, number>;
    sections: FeatureRegistrySection[];
}

const MCP_SURFACES: FeatureRegistryItem[] = [
    { name: 'nexus_session_bootstrap', surface: 'core MCP', purpose: 'Recover session context, memory stats, catalog health, and next-step guidance.', notes: 'Default first call for non-trivial work.' },
    { name: 'nexus_orchestrate', surface: 'core MCP', purpose: 'Plan, select assets, execute through worktree-backed runtime, and persist truth.', notes: 'Default raw-prompt execution path.' },
    { name: 'nexus_plan_execution', surface: 'planning MCP', purpose: 'Inspect the planner ledger before mutation.', notes: 'Used when operators want a pre-run ledger.' },
    { name: 'nexus_recall_memory / nexus_memory_stats / nexus_store_memory', surface: 'memory MCP', purpose: 'Inspect and persist durable learnings.', notes: 'Feeds the memory fabric and handoff flow.' },
    { name: 'nexus_optimize_tokens', surface: 'optimization MCP', purpose: 'Inspect or override source-aware token budgeting.', notes: 'Manual/diagnostic surface; orchestration applies budgeting automatically.' },
    { name: 'nexus_mindkit_check / nexus_ghost_pass / nexus_spawn_workers', surface: 'safety + runtime MCP', purpose: 'Run governance preflight, pre-read analysis, and explicit swarm control.', notes: 'Expert or low-level surfaces.' },
    { name: 'nexus_memory_export / import / backup / maintain / trace', surface: 'memory portability MCP', purpose: 'Export, restore, maintain, and inspect local-first memory bundles.', notes: 'Supports backup/resume and OpenClaw-oriented bridge packs.' },
    { name: 'nexus_list_skills / workflows / hooks / automations / specialists / crews', surface: 'catalog MCP', purpose: 'Expose what the runtime can activate.', notes: 'Used for explicit operator control and diagnostics.' },
    { name: 'nexus_run_status / nexus_federation_status / nexus_session_dna', surface: 'runtime truth MCP', purpose: 'Inspect persisted run state, federation status, and handoff DNA.', notes: 'Used after execution or during operating-layer work.' },
];

const CLIENT_BOOTSTRAP_TARGETS: FeatureRegistryItem[] = [
    { name: 'Codex', surface: 'bootstrap target', purpose: 'Writes a managed Nexus Prime block into repo-local AGENTS.md.', notes: 'Workspace-scoped bootstrap.' },
    { name: 'Cursor', surface: 'bootstrap target', purpose: 'Installs MCP config plus project-local .cursor/rules/nexus-prime.mdc.', notes: 'Home + workspace surfaces.' },
    { name: 'Claude Code', surface: 'bootstrap target', purpose: 'Installs MCP config plus generated markdown bootstrap note.', notes: 'Project note under .agent/client-bootstrap.' },
    { name: 'Opencode', surface: 'bootstrap target', purpose: 'Installs config plus generated markdown bootstrap note.', notes: 'Project note under .agent/client-bootstrap.' },
    { name: 'Windsurf', surface: 'bootstrap target', purpose: 'Installs MCP config plus .windsurfrules.', notes: 'Workspace-scoped rule surface.' },
    { name: 'Antigravity / OpenClaw', surface: 'bootstrap target', purpose: 'Installs MCP config plus split SKILL.md bundles sized to client limits.', notes: 'Home-scoped skill bundle.' },
];

const DASHBOARD_CAPABILITIES: FeatureRegistryItem[] = [
    { name: 'Overview', surface: 'dashboard', purpose: 'Runtime truth, lifetime token telemetry, graph-centered memory view, and system signals.', notes: 'Default operator cockpit.' },
    { name: 'Knowledge', surface: 'dashboard', purpose: 'Session-first RAG workflow, provenance, source mix, and bootstrap manifest truth.', notes: 'Shows attached, retrieved, selected, and dropped context.' },
    { name: 'Runs', surface: 'dashboard', purpose: 'Execution topology, verifier traces, and event stream.', notes: 'Centered on persisted runtime snapshots.' },
    { name: 'Catalog', surface: 'dashboard', purpose: 'Loaded assets, feature registry, and runtime-vs-available inventory.', notes: 'Separates what exists from what was used.' },
    { name: 'Governance', surface: 'dashboard', purpose: 'Guardrails, quarantine, federation health, and client bootstrap drift.', notes: 'Operator-facing trust layer.' },
];

const RUNTIME_SUBSYSTEMS: FeatureRegistryItem[] = [
    { name: 'Knowledge Fabric', surface: 'runtime subsystem', purpose: 'Balances repo, memory, RAG, patterns, and runtime traces into one execution bundle.', notes: 'Feeds planner, packet, and worker context.' },
    { name: 'Memory Control Plane', surface: 'runtime subsystem', purpose: 'Reconciles facts with add/update/merge/delete/quarantine semantics and vault projection.', notes: 'Local-first memory remains inspectable and portable.' },
    { name: 'Worktree Doctor', surface: 'runtime subsystem', purpose: 'Prunes stale git worktree metadata and records worktree health ahead of execution.', notes: 'Protects nexus_orchestrate and verifier lanes from stale temp state.' },
    { name: 'Source-Aware Token Budget', surface: 'runtime subsystem', purpose: 'Allocates token budget across repo, memory, RAG, patterns, and runtime traces.', notes: 'Persists selected and dropped context.' },
    { name: 'Bootstrap Manifest Truth', surface: 'runtime subsystem', purpose: 'Tracks configured client bootstrap artifacts independently from active heartbeats.', notes: 'Supports installed vs active truth in the dashboard.' },
    { name: 'Artifact Selection Audit', surface: 'runtime subsystem', purpose: 'Explains why skills/workflows/crews/specialists were selected or rejected.', notes: 'Persists auditable selection rationale.' },
];

const RELEASE_GATES: FeatureRegistryItem[] = [
    { name: 'Build + lint + tests', surface: 'release gate', purpose: 'Compile, lint, and validate runtime/docs/public surfaces.', notes: 'Canonical quality matrix.' },
    { name: 'Package smoke', surface: 'release gate', purpose: 'Verify npm packaging via dry-run before publish.', notes: 'Catches release surface drift.' },
    { name: 'Dependency audit + SBOM', surface: 'release gate', purpose: 'Track shipping dependency risk and document exceptions.', notes: 'Security hardening gate.' },
    { name: 'Workflow lint', surface: 'release gate', purpose: 'Validate workflow syntax and release automation contracts.', notes: 'Protects CI/CD drift.' },
    { name: 'Runtime smoke', surface: 'release gate', purpose: 'Exercise MCP startup, setup-all bootstrap, and dashboard boot.', notes: 'Final operator-facing release check.' },
];

function compact(value: string, max = 140): string {
    const singleLine = String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/\|/g, '\\|')
        .trim();
    if (!singleLine) return 'n/a';
    return singleLine.length > max ? `${singleLine.slice(0, max - 1).trim()}…` : singleLine;
}

function renderTable(items: FeatureRegistryItem[]): string {
    const headers = ['Name', 'Surface', 'Purpose', 'Notes'];
    const head = `| ${headers.join(' | ')} |`;
    const divider = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = items.map((item) => `| ${compact(item.name)} | ${compact(item.surface)} | ${compact(item.purpose)} | ${compact(item.notes)} |`).join('\n');
    return [head, divider, body].join('\n');
}

export function buildFeatureRegistry(workspaceRoot: string = process.cwd()): FeatureRegistryDocument {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-prime-feature-registry-'));
    const skillRuntime = new SkillRuntime(undefined, path.join(tempRoot, 'skills'), workspaceRoot);
    const workflowRuntime = new WorkflowRuntime(path.join(tempRoot, 'workflows'), workspaceRoot);
    const hookRuntime = new HookRuntime(path.join(tempRoot, 'hooks'), workspaceRoot);
    const automationRuntime = new AutomationRuntime(path.join(tempRoot, 'automations'), workspaceRoot);
    const crews = listCrewTemplates();
    const specialists = listSpecialists();

    const sections: FeatureRegistrySection[] = [
        {
            id: 'mcp-surfaces',
            title: 'MCP Surfaces',
            summary: 'Operator-facing entrypoints and expert control surfaces.',
            items: MCP_SURFACES,
        },
        {
            id: 'client-bootstrap',
            title: 'Client Bootstrap Targets',
            summary: 'Client-native installation and bootstrap surfaces managed by Nexus Prime.',
            items: CLIENT_BOOTSTRAP_TARGETS,
        },
        {
            id: 'dashboard-capabilities',
            title: 'Dashboard Capabilities',
            summary: 'What the topology console exposes from persisted runtime truth.',
            items: DASHBOARD_CAPABILITIES,
        },
        {
            id: 'runtime-subsystems',
            title: 'Runtime Subsystems',
            summary: 'Core architecture layers that shape execution, memory, and visibility.',
            items: [
                ...RUNTIME_SUBSYSTEMS,
                {
                    name: `Bundled assets: ${skillRuntime.listArtifacts().length} skills · ${workflowRuntime.listArtifacts().length} workflows · ${hookRuntime.listArtifacts().length} hooks · ${automationRuntime.listArtifacts().length} automations · ${crews.length} crews · ${specialists.length} specialists`,
                    surface: 'runtime subsystem',
                    purpose: 'Summarizes the current bundled runtime inventory.',
                    notes: 'Detailed lists live in the runtime catalog section and dashboard catalog view.',
                },
            ],
        },
        {
            id: 'release-gates',
            title: 'Release Gates',
            summary: 'Quality and security checks required before release.',
            items: RELEASE_GATES,
        },
    ];

    return {
        generatedAt: new Date().toISOString(),
        generatedFor: path.basename(workspaceRoot),
        counts: {
            mcpSurfaces: MCP_SURFACES.length,
            clientTargets: CLIENT_BOOTSTRAP_TARGETS.length,
            dashboardCapabilities: DASHBOARD_CAPABILITIES.length,
            runtimeSubsystems: RUNTIME_SUBSYSTEMS.length,
            releaseGates: RELEASE_GATES.length,
            skills: skillRuntime.listArtifacts().length,
            workflows: workflowRuntime.listArtifacts().length,
            hooks: hookRuntime.listArtifacts().length,
            automations: automationRuntime.listArtifacts().length,
            crews: crews.length,
            specialists: specialists.length,
        },
        sections,
    };
}

export function renderFeatureRegistryMarkdown(document: FeatureRegistryDocument): string {
    const sections = document.sections.map((section) => [
        '<details>',
        `<summary><b>${section.title}</b> (${section.items.length})</summary>`,
        '',
        section.summary,
        '',
        renderTable(section.items),
        '',
        '</details>',
    ].join('\n')).join('\n\n');

    const inventorySnapshot = [
        `Inventory Snapshot: ${document.counts.skills} skills · ${document.counts.workflows} workflows · ${document.counts.hooks} hooks · ${document.counts.automations} automations · ${document.counts.crews} crews · ${document.counts.specialists} specialists`,
        `Control Plane Snapshot: ${document.counts.mcpSurfaces} MCP surfaces · ${document.counts.clientTargets} client targets · ${document.counts.dashboardCapabilities} dashboard capabilities · ${document.counts.runtimeSubsystems} runtime subsystems · ${document.counts.releaseGates} release gates`,
    ].join('\n\n');

    return [
        '<details>',
        '<summary><b>🧭 Platform Feature Registry</b></summary>',
        '',
        `Generated from shared feature metadata at ${document.generatedAt}.`,
        '',
        inventorySnapshot,
        '',
        sections,
        '',
        '</details>',
    ].join('\n');
}
