import * as fs from 'fs';
import * as path from 'path';
import { resolveNexusStateDir } from './runtime-registry.js';

export interface PatternCard {
    patternId: string;
    name: string;
    category: 'orchestration' | 'workflow' | 'rag' | 'retrieval' | 'integration' | 'evaluation' | 'crew';
    summary: string;
    instructions: string;
    tags: string[];
    stages: string[];
    suggestedSkills: string[];
    suggestedWorkflows: string[];
    suggestedHooks: string[];
    suggestedAutomations: string[];
    suggestedCrews: string[];
    suggestedSpecialists: string[];
    confidence: number;
    successCount: number;
    failureCount: number;
    lastUsedAt?: number;
}

export interface PatternSearchResult extends PatternCard {
    score: number;
}

const BUILTIN_PATTERNS: PatternCard[] = [
    {
        patternId: 'pattern_orchestrator_repo_focus',
        name: 'Repo-Focused Orchestration',
        category: 'orchestration',
        summary: 'Bias execution toward code, planner state, and verification when the task clearly targets local implementation.',
        instructions: 'Use repo discovery, planner selection, and verification-first workflows when the prompt is implementation heavy and attached corpora are absent or low-signal.',
        tags: ['repo', 'implementation', 'planner', 'verification'],
        stages: ['bootstrap', 'planning', 'mutation', 'verification'],
        suggestedSkills: ['repo-architecture-scout', 'codex-real-workflow'],
        suggestedWorkflows: ['backend-execution-loop'],
        suggestedHooks: ['run-created-brief'],
        suggestedAutomations: ['verified-followup-automation'],
        suggestedCrews: ['crew_implementation'],
        suggestedSpecialists: [],
        confidence: 0.82,
        successCount: 12,
        failureCount: 1,
    },
    {
        patternId: 'pattern_rag_guided_research',
        name: 'Session RAG Guided Research',
        category: 'rag',
        summary: 'Use attached session collections to ground planning and summarization without promoting raw corpus content into memory.',
        instructions: 'Retrieve only top-ranked chunks from attached collections, summarize their relevance, and keep raw material session-scoped unless distilled findings are validated.',
        tags: ['rag', 'research', 'session', 'retrieval'],
        stages: ['bootstrap', 'planning'],
        suggestedSkills: ['browser-to-mission'],
        suggestedWorkflows: ['research-and-implement'],
        suggestedHooks: ['run-created-brief'],
        suggestedAutomations: [],
        suggestedCrews: ['crew_research'],
        suggestedSpecialists: [],
        confidence: 0.79,
        successCount: 8,
        failureCount: 1,
    },
    {
        patternId: 'pattern_runtime_failure_expansion',
        name: 'Repeated Failure Expansion',
        category: 'workflow',
        summary: 'Escalate swarm breadth and continuation planning when prior runtime traces show repeated failures or blocked verification.',
        instructions: 'Use prior runtime traces to widen the worker set, attach postmortem evidence, and prefer continuation-capable orchestration modes.',
        tags: ['runtime', 'failures', 'continuation', 'swarm'],
        stages: ['planning', 'continuation'],
        suggestedSkills: ['mission-postmortem'],
        suggestedWorkflows: ['research-and-implement'],
        suggestedHooks: ['retry-narrow-scope'],
        suggestedAutomations: ['failure-recovery-automation'],
        suggestedCrews: ['crew_implementation'],
        suggestedSpecialists: [],
        confidence: 0.76,
        successCount: 6,
        failureCount: 2,
    },
    {
        patternId: 'pattern_governed_release',
        name: 'Governed Release Pass',
        category: 'workflow',
        summary: 'Combine release preparation with governance and delivery checks when prompts mention release, ship, or publish work.',
        instructions: 'Run planner selection, release workflows, automation review, and governance gates before packaging or tagging.',
        tags: ['release', 'governance', 'automation'],
        stages: ['planning', 'verification'],
        suggestedSkills: ['codex-real-workflow'],
        suggestedWorkflows: ['release-pipeline'],
        suggestedHooks: ['before-verify-approval'],
        suggestedAutomations: ['verified-followup-automation'],
        suggestedCrews: ['crew_implementation'],
        suggestedSpecialists: [],
        confidence: 0.8,
        successCount: 7,
        failureCount: 0,
    },
    {
        patternId: 'pattern_low_tier_preflight',
        name: 'Low-Tier Preflight Filter',
        category: 'retrieval',
        summary: 'Reserve lower-tier models for filtering, ranking, and summarization while keeping mutation authority on the higher tier.',
        instructions: 'Use low-tier stages for candidate discovery, query rewriting, and compression suggestions. Escalate to the high tier for final planning and mutation.',
        tags: ['model-tier', 'retrieval', 'compression'],
        stages: ['bootstrap', 'planning'],
        suggestedSkills: ['systematic-planning'],
        suggestedWorkflows: [],
        suggestedHooks: [],
        suggestedAutomations: [],
        suggestedCrews: [],
        suggestedSpecialists: [],
        confidence: 0.74,
        successCount: 4,
        failureCount: 0,
    },
];

export class PatternRegistry {
    private readonly statePath: string;
    private readonly cards: PatternCard[];

    constructor(stateRoot: string = resolveNexusStateDir()) {
        this.statePath = path.join(stateRoot, 'pattern-registry.json');
        this.cards = this.loadCards();
    }

    list(): PatternCard[] {
        return [...this.cards].sort((left, right) => {
            const leftScore = left.successCount - left.failureCount;
            const rightScore = right.successCount - right.failureCount;
            return rightScore - leftScore || left.name.localeCompare(right.name);
        });
    }

    search(query: string, limit: number = 5): PatternSearchResult[] {
        const keywords = extractKeywords(query);
        return this.cards
            .map((card) => {
                const successBias = Math.max(0, card.successCount - card.failureCount);
                const score = scoreText(`${card.name}\n${card.summary}\n${card.instructions}\n${card.tags.join(' ')}`, keywords)
                    + Math.round(card.confidence * 10)
                    + successBias;
                return { ...card, score };
            })
            .filter((card) => card.score > 0)
            .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
            .slice(0, Math.max(1, Math.min(12, limit)));
    }

    recordOutcome(patternId: string, success: boolean): void {
        const card = this.cards.find((entry) => entry.patternId === patternId);
        if (!card) return;
        if (success) {
            card.successCount += 1;
        } else {
            card.failureCount += 1;
        }
        card.lastUsedAt = Date.now();
        this.persist();
    }

    private loadCards(): PatternCard[] {
        if (!fs.existsSync(this.statePath)) {
            this.persistCards(BUILTIN_PATTERNS);
            return BUILTIN_PATTERNS.map((card) => ({ ...card }));
        }

        try {
            const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as PatternCard[];
            const byId = new Map(parsed.map((card) => [card.patternId, card]));
            for (const builtin of BUILTIN_PATTERNS) {
                if (!byId.has(builtin.patternId)) {
                    byId.set(builtin.patternId, { ...builtin });
                }
            }
            const cards = [...byId.values()];
            this.persistCards(cards);
            return cards;
        } catch {
            this.persistCards(BUILTIN_PATTERNS);
            return BUILTIN_PATTERNS.map((card) => ({ ...card }));
        }
    }

    private persist(): void {
        this.persistCards(this.cards);
    }

    private persistCards(cards: PatternCard[]): void {
        fs.writeFileSync(this.statePath, JSON.stringify(cards, null, 2), 'utf8');
    }
}

function extractKeywords(value: string): string[] {
    return String(value || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3);
}

function scoreText(value: string, keywords: string[]): number {
    const lower = String(value || '').toLowerCase();
    return keywords.reduce((sum, keyword) => sum + (lower.includes(keyword) ? 3 : 0), 0);
}
