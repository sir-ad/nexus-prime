import { exec as execCallback } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const exec = promisify(execCallback);

const NEXUS_WORKTREE_MARKERS = [
    `${path.sep}nexus-prime-worktrees${path.sep}`,
    `${path.sep}nexus-phantom${path.sep}`,
];

const NEXUS_WORKTREE_PREFIXES = [
    'planner-',
    'coder-',
    'verifier-',
    'skill-maker-',
    'research-shadow-',
    'phantom-',
];

export type WorktreeHealthIssueKind =
    | 'prunable'
    | 'missing-commondir'
    | 'missing-gitdir'
    | 'missing-head'
    | 'broken-gitdir'
    | 'stale-temp-worktree'
    | 'prune-failed'
    | 'repair-failed';

export interface WorktreeHealthIssue {
    kind: WorktreeHealthIssueKind;
    target: string;
    detail: string;
    repaired: boolean;
}

export interface WorktreeHealthSnapshot {
    generatedAt: number;
    repoRoot: string;
    overall: 'healthy' | 'degraded';
    activeEntries: number;
    prunableEntries: number;
    brokenEntries: number;
    repairedEntries: number;
    issues: WorktreeHealthIssue[];
    actions: string[];
}

export class WorktreeDoctorError extends Error {
    readonly snapshot: WorktreeHealthSnapshot;
    readonly remediation: string[];

    constructor(message: string, snapshot: WorktreeHealthSnapshot, remediation: string[]) {
        super(message);
        this.name = 'WorktreeDoctorError';
        this.snapshot = snapshot;
        this.remediation = remediation;
    }
}

interface WorktreeListEntry {
    worktreePath: string;
    prunable: boolean;
}

function isNexusOwnedPath(target: string): boolean {
    const normalized = path.normalize(target);
    if (NEXUS_WORKTREE_MARKERS.some((marker) => normalized.includes(marker))) {
        return true;
    }
    const base = path.basename(normalized);
    return NEXUS_WORKTREE_PREFIXES.some((prefix) => base.startsWith(prefix));
}

function parsePorcelain(stdout: string): WorktreeListEntry[] {
    const blocks = stdout.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
    return blocks.map((block) => {
        const entry: WorktreeListEntry = {
            worktreePath: '',
            prunable: false,
        };
        for (const line of block.split('\n')) {
            if (line.startsWith('worktree ')) {
                entry.worktreePath = line.slice('worktree '.length).trim();
            } else if (line.startsWith('prunable')) {
                entry.prunable = true;
            }
        }
        return entry;
    }).filter((entry) => entry.worktreePath);
}

async function resolveGitDir(repoRoot: string): Promise<string | null> {
    try {
        const { stdout } = await exec('git rev-parse --absolute-git-dir', { cwd: repoRoot });
        const target = stdout.trim();
        return target ? path.resolve(repoRoot, target) : null;
    } catch {
        return null;
    }
}

function safeRead(filePath: string): string {
    try {
        return fs.readFileSync(filePath, 'utf8').trim();
    } catch {
        return '';
    }
}

function deriveWorktreePath(gitdirTarget: string): string {
    if (!gitdirTarget) return '';
    const normalized = path.normalize(gitdirTarget);
    if (path.basename(normalized) === '.git') {
        return path.dirname(normalized);
    }
    return normalized;
}

function toSnapshot(repoRoot: string, entries: WorktreeListEntry[], issues: WorktreeHealthIssue[], actions: string[]): WorktreeHealthSnapshot {
    const prunableEntries = entries.filter((entry) => entry.prunable).length;
    const brokenEntries = issues.filter((issue) => issue.kind !== 'prunable').length;
    const repairedEntries = issues.filter((issue) => issue.repaired).length;
    return {
        generatedAt: Date.now(),
        repoRoot,
        overall: issues.some((issue) => !issue.repaired) ? 'degraded' : 'healthy',
        activeEntries: entries.length,
        prunableEntries,
        brokenEntries,
        repairedEntries,
        issues,
        actions,
    };
}

export async function doctorGitWorktrees(repoRoot: string): Promise<WorktreeHealthSnapshot> {
    const gitDir = await resolveGitDir(repoRoot);
    if (!gitDir) {
        return {
            generatedAt: Date.now(),
            repoRoot,
            overall: 'healthy',
            activeEntries: 0,
            prunableEntries: 0,
            brokenEntries: 0,
            repairedEntries: 0,
            issues: [],
            actions: [],
        };
    }

    const issues: WorktreeHealthIssue[] = [];
    const actions: string[] = [];

    let entries: WorktreeListEntry[] = [];
    try {
        const { stdout } = await exec('git worktree list --porcelain', { cwd: repoRoot });
        entries = parsePorcelain(stdout);
    } catch (error: any) {
        issues.push({
            kind: 'repair-failed',
            target: repoRoot,
            detail: `Unable to inspect worktree list: ${String(error?.message ?? error)}`,
            repaired: false,
        });
        return toSnapshot(repoRoot, entries, issues, actions);
    }

    const prunable = entries.filter((entry) => entry.prunable);
    if (prunable.length > 0) {
        try {
            const { stdout, stderr } = await exec('git worktree prune --verbose', { cwd: repoRoot });
            const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
            actions.push(combined ? `pruned stale worktree metadata: ${combined}` : 'pruned stale worktree metadata');
            prunable.forEach((entry) => {
                issues.push({
                    kind: 'prunable',
                    target: entry.worktreePath,
                    detail: 'Git reported this worktree entry as prunable.',
                    repaired: true,
                });
            });
        } catch (error: any) {
            prunable.forEach((entry) => {
                issues.push({
                    kind: 'prune-failed',
                    target: entry.worktreePath,
                    detail: `git worktree prune failed: ${String(error?.message ?? error)}`,
                    repaired: false,
                });
            });
        }
    }

    const metadataRoot = path.join(gitDir, 'worktrees');
    if (fs.existsSync(metadataRoot)) {
        for (const entry of fs.readdirSync(metadataRoot)) {
            const entryDir = path.join(metadataRoot, entry);
            if (!fs.statSync(entryDir).isDirectory()) continue;

            const commondirPath = path.join(entryDir, 'commondir');
            const gitdirPath = path.join(entryDir, 'gitdir');
            const headPath = path.join(entryDir, 'HEAD');
            const gitdirTarget = safeRead(gitdirPath);
            const worktreePath = deriveWorktreePath(gitdirTarget);
            const nexusOwned = isNexusOwnedPath(worktreePath || entryDir) || isNexusOwnedPath(entry);

            const missing: Array<{ kind: WorktreeHealthIssueKind; label: string }> = [];
            if (!fs.existsSync(commondirPath)) missing.push({ kind: 'missing-commondir', label: commondirPath });
            if (!fs.existsSync(gitdirPath)) missing.push({ kind: 'missing-gitdir', label: gitdirPath });
            if (!fs.existsSync(headPath)) missing.push({ kind: 'missing-head', label: headPath });

            if (missing.length > 0) {
                if (nexusOwned) {
                    fs.rmSync(entryDir, { recursive: true, force: true });
                    actions.push(`removed broken Nexus worktree metadata ${entry}`);
                    missing.forEach((item) => {
                        issues.push({
                            kind: item.kind,
                            target: item.label,
                            detail: 'Missing required git worktree metadata file.',
                            repaired: true,
                        });
                    });
                    continue;
                }

                missing.forEach((item) => {
                    issues.push({
                        kind: item.kind,
                        target: item.label,
                        detail: 'Missing required git worktree metadata file.',
                        repaired: false,
                    });
                });
                continue;
            }

            if (gitdirTarget && !fs.existsSync(gitdirTarget)) {
                if (nexusOwned || worktreePath.startsWith(path.join(os.tmpdir(), ''))) {
                    fs.rmSync(entryDir, { recursive: true, force: true });
                    actions.push(`removed stale temp worktree metadata ${entry}`);
                    issues.push({
                        kind: 'stale-temp-worktree',
                        target: worktreePath || entry,
                        detail: 'The worktree gitdir target no longer exists.',
                        repaired: true,
                    });
                    continue;
                }

                issues.push({
                    kind: 'broken-gitdir',
                    target: worktreePath || entry,
                    detail: 'The worktree gitdir target no longer exists.',
                    repaired: false,
                });
            }
        }
    }

    entries = [];
    try {
        const { stdout } = await exec('git worktree list --porcelain', { cwd: repoRoot });
        entries = parsePorcelain(stdout);
    } catch {
        // Preserve the already captured issues; the add path will still fail explicitly.
    }

    return toSnapshot(repoRoot, entries, issues, actions);
}

export function summarizeWorktreeHealth(snapshot: WorktreeHealthSnapshot | undefined): string {
    if (!snapshot) return 'Worktree health not recorded yet.';
    const detail = [
        `${snapshot.activeEntries} active`,
        `${snapshot.prunableEntries} prunable`,
        `${snapshot.brokenEntries} broken`,
        `${snapshot.repairedEntries} repaired`,
    ].join(' · ');
    return `${snapshot.overall} · ${detail}`;
}

export function toWorktreeRemediation(error: unknown, worktreeDir?: string): string[] {
    const message = String((error as any)?.message ?? error ?? '').trim();
    const suggestions = [
        'Run `git worktree prune --verbose` in the repo root.',
        'Remove stale Nexus temp worktrees under your system temp directory if they still exist.',
        'Retry `nexus_orchestrate` after the worktree registry is clean.',
    ];
    if (worktreeDir) {
        suggestions.unshift(`Failed while preparing ${worktreeDir}.`);
    }
    if (message && !message.includes('git worktree')) {
        suggestions.push(`Underlying error: ${message}`);
    }
    return suggestions;
}
