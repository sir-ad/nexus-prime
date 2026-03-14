export type MemoryCandidateKind =
    | 'fact'
    | 'decision'
    | 'failure-mode'
    | 'reuse-pattern'
    | 'file-map'
    | 'operator-preference';

export interface MemoryCandidateFact {
    kind: MemoryCandidateKind;
    content: string;
    tags: string[];
    confidence: number;
    ephemeral: boolean;
}

export interface MemoryProvenance {
    source: 'operator' | 'runtime' | 'worker' | 'imported' | 'system' | 'rag';
    sessionId?: string;
    runId?: string;
    workerId?: string;
    toolName?: string;
    references: string[];
    tags: string[];
    summary: string;
}

export type MemoryReconciliationAction = 'ADD' | 'UPDATE' | 'MERGE' | 'DELETE' | 'NONE' | 'QUARANTINE';

export interface MemoryReconciliationEntry {
    candidate: string;
    action: MemoryReconciliationAction;
    reason: string;
    relatedIds: string[];
    storedId?: string;
    expiresAt?: number;
}

export interface MemoryReconciliationSummary {
    generatedAt: number;
    actionCounts: Record<MemoryReconciliationAction, number>;
    entries: MemoryReconciliationEntry[];
}

export interface MemoryMaintenanceResult {
    generatedAt: number;
    expired: number;
    cooled: number;
    quarantined: number;
    scrapMarked: number;
    retained: number;
}

const STOP_WORDS = new Set([
    'with',
    'from',
    'this',
    'that',
    'then',
    'also',
    'into',
    'about',
    'when',
    'where',
    'which',
    'what',
]);

export function deriveCandidateFacts(content: string, tags: string[] = [], limit: number = 6): MemoryCandidateFact[] {
    const normalized = String(content || '').trim();
    if (!normalized) return [];

    const segments = normalized
        .split(/\n+|(?<=[.!?;])\s+/)
        .map((segment) => segment.trim())
        .filter(Boolean)
        .filter((segment) => segment.length >= 24)
        .slice(0, Math.max(1, limit));

    const candidates = (segments.length > 0 ? segments : [normalized]).map((segment) => {
        const kind = inferCandidateKind(segment, tags);
        const lowered = segment.toLowerCase();
        const confidence = Math.max(
            0.45,
            Math.min(
                0.96,
                0.55
                    + (/(root cause|because|caused by|decision|prefer|pattern|reuse|map|file|worker|run|session)/i.test(segment) ? 0.18 : 0)
                    + (segment.length <= 220 ? 0.08 : -0.05)
                    + (tags.length > 0 ? 0.06 : 0),
            ),
        );
        return {
            kind,
            content: segment,
            tags: mergeTags(tags, kind),
            confidence: Number(confidence.toFixed(2)),
            ephemeral: /temporary|for now|for this run|until verified|draft|placeholder|wip|follow-up/i.test(lowered),
        } satisfies MemoryCandidateFact;
    });

    return dedupeCandidates(candidates).slice(0, Math.max(1, limit));
}

export function createEmptyReconciliationSummary(): MemoryReconciliationSummary {
    return {
        generatedAt: Date.now(),
        actionCounts: {
            ADD: 0,
            UPDATE: 0,
            MERGE: 0,
            DELETE: 0,
            NONE: 0,
            QUARANTINE: 0,
        },
        entries: [],
    };
}

export function createMemoryProvenance(input: Partial<MemoryProvenance> & { source: MemoryProvenance['source'] }): MemoryProvenance {
    return {
        source: input.source,
        sessionId: input.sessionId,
        runId: input.runId,
        workerId: input.workerId,
        toolName: input.toolName,
        references: dedupeStrings(input.references ?? []),
        tags: dedupeStrings(input.tags ?? []),
        summary: input.summary ?? `${input.source} memory event`,
    };
}

function inferCandidateKind(content: string, tags: string[]): MemoryCandidateKind {
    const lowered = content.toLowerCase();
    const haystack = `${lowered}\n${tags.join(' ').toLowerCase()}`;
    if (/(decision|choose|chose|approved|rejected|tradeoff|policy)/.test(haystack)) return 'decision';
    if (/(root cause|failure|bug|broken|regression|blocked|cause)/.test(haystack)) return 'failure-mode';
    if (/(pattern|reuse|template|playbook|heuristic)/.test(haystack)) return 'reuse-pattern';
    if (/(file map|entrypoint|boundary|module|path|contract|architecture)/.test(haystack)) return 'file-map';
    if (/(prefer|preference|likes|dislikes|wants|operator)/.test(haystack)) return 'operator-preference';
    return 'fact';
}

function mergeTags(tags: string[], kind: MemoryCandidateKind): string[] {
    const mappedTag = kind === 'failure-mode'
        ? '#failure-mode'
        : kind === 'reuse-pattern'
            ? '#reuse-pattern'
            : kind === 'operator-preference'
                ? '#operator-preference'
                : kind === 'file-map'
                    ? '#file-map'
                    : kind === 'decision'
                        ? '#decision'
                        : '#fact';
    return dedupeStrings([...tags, mappedTag]);
}

function dedupeCandidates(values: MemoryCandidateFact[]): MemoryCandidateFact[] {
    const seen = new Set<string>();
    const result: MemoryCandidateFact[] = [];
    for (const value of values) {
        const key = value.content.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !STOP_WORDS.has(token)).join(' ');
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(value);
    }
    return result;
}

function dedupeStrings(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}
