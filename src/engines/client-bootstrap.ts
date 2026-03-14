import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { InstructionGateway, type ClientBootstrapArtifact } from './instruction-gateway.js';
import { resolveNexusStateDir } from './runtime-registry.js';

export type SetupClientId = 'cursor' | 'claude' | 'opencode' | 'windsurf' | 'antigravity' | 'codex';
export type SetupInstructionMode = 'replace' | 'codex-managed-agents';
export type SetupInstructionScope = 'home' | 'workspace';
export type SetupState = 'missing' | 'drifted' | 'installed';

export interface SetupInstructionFile {
    path: string;
    content: string;
    scope: SetupInstructionScope;
    mode?: SetupInstructionMode;
}

export interface SetupDefinition {
    id: SetupClientId;
    label: string;
    configPath?: string;
    instructionFiles: SetupInstructionFile[];
}

export interface BootstrapManifestClientStatus {
    clientId: SetupClientId;
    label: string;
    state: SetupState;
    configPath?: string;
    instructionFiles: string[];
    homeReady: boolean;
    workspaceReady: boolean;
    summary: string;
    updatedAt: number;
}

export interface BootstrapManifestStatus {
    version: number;
    generatedAt: number;
    workspaceRoot?: string;
    clients: BootstrapManifestClientStatus[];
}

export interface EnsureBootstrapOptions {
    packageRoot: string;
    workspaceRoot?: string;
    phase?: 'install' | 'runtime';
    silent?: boolean;
}

const CODEX_MANAGED_START = '<!-- nexus-prime:codex-bootstrap:start -->';
const CODEX_MANAGED_END = '<!-- nexus-prime:codex-bootstrap:end -->';
const SUPPORTED_CLIENTS: SetupClientId[] = ['codex', 'cursor', 'claude', 'opencode', 'windsurf', 'antigravity'];

function ensureParentDir(targetPath: string): void {
    mkdirSync(dirname(targetPath), { recursive: true });
}

function readJson(targetPath: string): any {
    if (!existsSync(targetPath)) return {};
    try {
        return JSON.parse(readFileSync(targetPath, 'utf8'));
    } catch {
        return {};
    }
}

function buildStandardMcpServerConfig() {
    return {
        command: 'npx',
        args: ['-y', 'nexus-prime', 'mcp'],
        env: {
            NEXUS_MCP_TOOL_PROFILE: 'autonomous',
        },
    };
}

function writeStandardMcpConfig(targetPath: string): void {
    const existing = readJson(targetPath);
    existing.mcpServers = existing.mcpServers ?? {};
    existing.mcpServers['nexus-prime'] = buildStandardMcpServerConfig();
    ensureParentDir(targetPath);
    writeFileSync(targetPath, JSON.stringify(existing, null, 2));
}

function writeOpencodeConfig(targetPath: string): void {
    const existing = readJson(targetPath);
    const server = {
        id: 'nexus-prime',
        ...buildStandardMcpServerConfig(),
    };
    existing.mcp = existing.mcp ?? {};
    existing.mcp.servers = Array.isArray(existing.mcp.servers) ? existing.mcp.servers : [];
    existing.mcp.servers = existing.mcp.servers.filter((entry: any) => entry?.id !== 'nexus-prime');
    existing.mcp.servers.push(server);
    ensureParentDir(targetPath);
    writeFileSync(targetPath, JSON.stringify(existing, null, 2));
}

function renderCodexManagedBlock(content: string): string {
    return [
        CODEX_MANAGED_START,
        '## Nexus Prime Bootstrap (managed)',
        '',
        '> This block is managed by `nexus-prime setup codex` or automatic bootstrap.',
        '> Keep your project-specific Codex guidance above or below it.',
        '',
        content.trim(),
        CODEX_MANAGED_END,
    ].join('\n');
}

function mergeCodexAgentsContent(existingContent: string | null, content: string): string {
    const managedBlock = renderCodexManagedBlock(content);
    const existing = existingContent ?? '';

    if (!existing.trim()) {
        return [
            '# AGENTS.md',
            '',
            'This file is used by Codex and other repo-local agent tooling.',
            '',
            managedBlock,
            '',
        ].join('\n');
    }

    const startIndex = existing.indexOf(CODEX_MANAGED_START);
    const endIndex = existing.indexOf(CODEX_MANAGED_END);
    if (startIndex >= 0 && endIndex > startIndex) {
        const before = existing.slice(0, startIndex).trimEnd();
        const after = existing.slice(endIndex + CODEX_MANAGED_END.length).trimStart();
        return [
            before,
            before ? '' : undefined,
            managedBlock,
            after ? '' : undefined,
            after,
            '',
        ].filter((value): value is string => value !== undefined).join('\n');
    }

    return [
        existing.trimEnd(),
        '',
        managedBlock,
        '',
    ].join('\n');
}

function hasCurrentCodexManagedBlock(targetPath: string, content: string): SetupState {
    if (!existsSync(targetPath)) return 'missing';
    const existing = readFileSync(targetPath, 'utf8');
    const startIndex = existing.indexOf(CODEX_MANAGED_START);
    const endIndex = existing.indexOf(CODEX_MANAGED_END);
    if (startIndex < 0 || endIndex <= startIndex) return 'drifted';
    const currentBlock = existing.slice(startIndex, endIndex + CODEX_MANAGED_END.length).trim();
    return currentBlock === renderCodexManagedBlock(content).trim() ? 'installed' : 'drifted';
}

function buildInstructionFiles(
    clientId: SetupClientId,
    packageRoot: string,
    workspaceRoot: string,
): SetupInstructionFile[] {
    const gateway = new InstructionGateway(packageRoot);
    const bundle = gateway.renderClientBootstrapBundle(clientId === 'claude' ? 'claude-code' : clientId, {
        toolProfile: 'autonomous',
    });

    if (clientId === 'codex') {
        return bundle.artifacts.map((artifact: ClientBootstrapArtifact) => ({
            path: join(workspaceRoot, 'AGENTS.md'),
            content: artifact.content,
            mode: 'codex-managed-agents',
            scope: 'workspace',
        }));
    }
    if (clientId === 'cursor') {
        return bundle.artifacts.map((artifact: ClientBootstrapArtifact) => ({
            path: join(workspaceRoot, '.cursor', 'rules', artifact.fileName),
            content: artifact.content,
            scope: 'workspace',
        }));
    }
    if (clientId === 'windsurf') {
        return bundle.artifacts.map((artifact: ClientBootstrapArtifact) => ({
            path: join(workspaceRoot, artifact.fileName),
            content: artifact.content,
            scope: 'workspace',
        }));
    }
    if (clientId === 'antigravity') {
        return bundle.artifacts.map((artifact: ClientBootstrapArtifact) => ({
            path: join(homedir(), '.antigravity', 'skills', 'nexus-prime', artifact.fileName),
            content: artifact.content,
            scope: 'home',
        }));
    }
    const fileName = clientId === 'claude' ? 'claude-code.md' : 'opencode.md';
    return bundle.artifacts.map((artifact: ClientBootstrapArtifact, index) => ({
        path: join(
            workspaceRoot,
            '.agent',
            'client-bootstrap',
            index === 0 ? fileName : `${fileName.replace(/\.md$/, '')}-${index + 1}.md`,
        ),
        content: artifact.content,
        scope: 'workspace',
    }));
}

export function getSetupDefinition(
    clientId: SetupClientId,
    options: { packageRoot: string; workspaceRoot?: string },
): SetupDefinition {
    const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    const instructionFiles = buildInstructionFiles(clientId, resolve(options.packageRoot), workspaceRoot);
    if (clientId === 'codex') {
        return { id: clientId, label: 'Codex', instructionFiles };
    }
    if (clientId === 'cursor') {
        return {
            id: clientId,
            label: 'Cursor',
            configPath: join(homedir(), '.cursor', 'mcp.json'),
            instructionFiles,
        };
    }
    if (clientId === 'claude') {
        return {
            id: clientId,
            label: 'Claude Code',
            configPath: join(homedir(), '.claude-code', 'mcp.json'),
            instructionFiles,
        };
    }
    if (clientId === 'opencode') {
        return {
            id: clientId,
            label: 'Opencode',
            configPath: join(homedir(), '.opencode', 'config.json'),
            instructionFiles,
        };
    }
    if (clientId === 'windsurf') {
        return {
            id: clientId,
            label: 'Windsurf',
            configPath: join(homedir(), '.windsurf', 'mcp.json'),
            instructionFiles,
        };
    }
    return {
        id: clientId,
        label: 'Antigravity / OpenClaw',
        configPath: join(homedir(), '.antigravity', 'mcp.json'),
        instructionFiles,
    };
}

export function installSetup(
    definition: SetupDefinition,
    options: { scope?: 'all' | 'home' | 'workspace' } = {},
): void {
    const scope = options.scope ?? 'all';
    if (definition.configPath && scope !== 'workspace') {
        if (definition.id === 'opencode') {
            writeOpencodeConfig(definition.configPath);
        } else {
            writeStandardMcpConfig(definition.configPath);
        }
    }
    for (const file of definition.instructionFiles) {
        if (scope === 'home' && file.scope !== 'home') continue;
        if (scope === 'workspace' && file.scope !== 'workspace') continue;
        ensureParentDir(file.path);
        if (file.mode === 'codex-managed-agents') {
            const existing = existsSync(file.path) ? readFileSync(file.path, 'utf8') : null;
            writeFileSync(file.path, mergeCodexAgentsContent(existing, file.content), 'utf8');
            continue;
        }
        writeFileSync(file.path, file.content, 'utf8');
    }
}

export function hasExpectedConfig(definition: SetupDefinition): boolean {
    if (!definition.configPath || !existsSync(definition.configPath)) return false;
    try {
        const parsed = JSON.parse(readFileSync(definition.configPath, 'utf8'));
        if (definition.id === 'opencode') {
            const servers = parsed?.mcp?.servers;
            return Array.isArray(servers) && servers.some((entry: any) =>
                entry?.id === 'nexus-prime'
                && entry?.command === 'npx'
                && Array.isArray(entry?.args)
                && entry.args.includes('nexus-prime')
                && entry?.env?.NEXUS_MCP_TOOL_PROFILE === 'autonomous');
        }
        const server = parsed?.mcpServers?.['nexus-prime'];
        return Boolean(
            server
            && server.command === 'npx'
            && Array.isArray(server.args)
            && server.args.includes('nexus-prime')
            && server?.env?.NEXUS_MCP_TOOL_PROFILE === 'autonomous',
        );
    } catch {
        return false;
    }
}

function instructionState(definition: SetupDefinition, scope?: SetupInstructionScope): SetupState {
    let hasAny = false;
    for (const file of definition.instructionFiles) {
        if (scope && file.scope !== scope) continue;
        if (file.mode === 'codex-managed-agents') {
            const codexState = hasCurrentCodexManagedBlock(file.path, file.content);
            if (codexState === 'drifted') return 'drifted';
            if (codexState === 'installed') hasAny = true;
            continue;
        }
        if (!existsSync(file.path)) continue;
        hasAny = true;
        if (readFileSync(file.path, 'utf8') !== file.content) {
            return 'drifted';
        }
    }
    if (!hasAny) return 'missing';
    return definition.instructionFiles
        .filter((file) => !scope || file.scope === scope)
        .every((file) => existsSync(file.path))
        ? 'installed'
        : 'missing';
}

export function statusForDefinition(definition: SetupDefinition): { state: SetupState; summary: string; homeReady: boolean; workspaceReady: boolean } {
    const configOk = definition.configPath ? hasExpectedConfig(definition) : true;
    const workspaceState = instructionState(definition, 'workspace');
    const homeState = instructionState(definition, 'home');
    const homeReady = configOk && homeState !== 'drifted';
    const workspaceReady = workspaceState === 'installed' || definition.instructionFiles.every((file) => file.scope !== 'workspace');
    if (configOk && workspaceState !== 'drifted' && homeState !== 'drifted' && workspaceReady) {
        return {
            state: 'installed',
            summary: definition.configPath
                ? 'Config and client instructions are current'
                : 'Managed client instructions are current',
            homeReady,
            workspaceReady,
        };
    }
    if ((definition.configPath && existsSync(definition.configPath)) || workspaceState !== 'missing' || homeState !== 'missing') {
        return {
            state: 'drifted',
            summary: definition.configPath
                ? 'Setup exists but is missing the autonomous profile or current instructions'
                : 'A client instruction file exists, but the managed Nexus Prime bootstrap block is missing or outdated',
            homeReady,
            workspaceReady,
        };
    }
    return {
        state: 'missing',
        summary: definition.configPath ? 'Setup not installed yet' : 'No managed client instruction file installed yet',
        homeReady: false,
        workspaceReady: false,
    };
}

export function supportedSetupClients(): SetupClientId[] {
    return [...SUPPORTED_CLIENTS];
}

function workspaceEligible(workspaceRoot: string): boolean {
    return existsSync(join(workspaceRoot, 'package.json'))
        || existsSync(join(workspaceRoot, '.git'))
        || existsSync(join(workspaceRoot, 'AGENTS.md'));
}

function ensureWorkspaceAgentScaffold(workspaceRoot: string): void {
    const directories = [
        '.agent',
        '.agent/client-bootstrap',
        '.agent/runtime',
        '.agent/rules',
        '.agent/skills',
        '.agent/workflows',
        '.agent/hooks',
        '.agent/automations',
        '.agent/crews',
        '.agent/specialists',
    ];
    directories.forEach((relativeDir) => {
        mkdirSync(join(workspaceRoot, relativeDir), { recursive: true });
    });
}

function bootstrapManifestPath(stateRoot?: string): string {
    return join(stateRoot ?? resolveNexusStateDir(), 'bootstrap-manifest.json');
}

export function readBootstrapManifest(stateRoot?: string): BootstrapManifestStatus | undefined {
    const target = bootstrapManifestPath(stateRoot);
    if (!existsSync(target)) return undefined;
    try {
        return JSON.parse(readFileSync(target, 'utf8')) as BootstrapManifestStatus;
    } catch {
        return undefined;
    }
}

export function writeBootstrapManifest(status: BootstrapManifestStatus, stateRoot?: string): BootstrapManifestStatus {
    const target = bootstrapManifestPath(stateRoot);
    ensureParentDir(target);
    writeFileSync(target, JSON.stringify(status, null, 2), 'utf8');
    return status;
}

export function collectBootstrapManifest(options: { packageRoot: string; workspaceRoot?: string }): BootstrapManifestStatus {
    const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    return {
        version: 1,
        generatedAt: Date.now(),
        workspaceRoot,
        clients: SUPPORTED_CLIENTS.map((clientId) => {
            const definition = getSetupDefinition(clientId, { packageRoot: options.packageRoot, workspaceRoot });
            const status = statusForDefinition(definition);
            return {
                clientId,
                label: definition.label,
                state: status.state,
                configPath: definition.configPath,
                instructionFiles: definition.instructionFiles.map((file) => file.path),
                homeReady: status.homeReady,
                workspaceReady: status.workspaceReady,
                summary: status.summary,
                updatedAt: Date.now(),
            } satisfies BootstrapManifestClientStatus;
        }),
    };
}

export function ensureBootstrap(options: EnsureBootstrapOptions): BootstrapManifestStatus {
    const packageRoot = resolve(options.packageRoot);
    const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    const phase = options.phase ?? 'runtime';
    const allowWorkspace = phase !== 'install' && workspaceEligible(workspaceRoot);
    const scope: 'all' | 'home' = allowWorkspace ? 'all' : 'home';

    if (allowWorkspace) {
        ensureWorkspaceAgentScaffold(workspaceRoot);
    }

    for (const clientId of SUPPORTED_CLIENTS) {
        const definition = getSetupDefinition(clientId, { packageRoot, workspaceRoot });
        installSetup(definition, { scope });
    }

    const manifest = collectBootstrapManifest({ packageRoot, workspaceRoot });
    writeBootstrapManifest(manifest);
    return manifest;
}
