import * as fs from 'fs';
import * as path from 'path';

export type SkillRiskClass = 'read' | 'orchestrate' | 'mutate';
export type SkillScope = 'base' | 'session' | 'worker' | 'runtime-hot' | 'global';
export type SkillCheckpoint = 'before-read' | 'before-mutate' | 'before-verify' | 'retry';

export type RuntimeBindingType =
    | 'write_file'
    | 'append_file'
    | 'replace_text'
    | 'run_command';

export interface RuntimeBinding {
    type: RuntimeBindingType;
    path?: string;
    content?: string;
    search?: string;
    replace?: string;
    command?: string;
}

export interface DomainSkillSeed {
    key: string;
    name: string;
    domain: string;
    description: string;
    riskClass: SkillRiskClass;
    scope: SkillScope;
    instructions: string[];
    triggerConditions: string[];
    expectedOutputs: string[];
    guardrails: string[];
    verifierHooks: string[];
    roleAffinity: string[];
    toolBindings: RuntimeBinding[];
}

export interface WorkflowStepSeed {
    title: string;
    command?: string;
    checkpoint?: SkillCheckpoint;
    role?: string;
    bindings?: RuntimeBinding[];
}

export interface DomainWorkflowSeed {
    key: string;
    name: string;
    domain: string;
    description: string;
    triggerConditions: string[];
    expectedOutputs: string[];
    guardrails: string[];
    verifierHooks: string[];
    roleAffinity: string[];
    steps: WorkflowStepSeed[];
}

export interface ParsedMarkdownArtifact {
    frontmatter: Record<string, unknown>;
    body: string;
}

const BASE_DOMAIN_SKILLS: Array<{
    domain: string;
    noun: string;
    instructions: string[];
    outputs: string[];
    guardrails: string[];
}> = [
    {
        domain: 'marketing',
        noun: 'message architecture',
        instructions: [
            'Map the primary audience, pain, desired outcome, and proof points before proposing copy.',
            'Prefer crisp positioning and launch narrative over broad feature lists.',
            'Tie every output back to user value and differentiation.',
        ],
        outputs: ['positioning brief', 'launch narrative', 'proof matrix'],
        guardrails: ['Do not invent customer evidence.', 'Do not overstate launch readiness.'],
    },
    {
        domain: 'product',
        noun: 'product framing',
        instructions: [
            'Translate goals into user jobs, constraints, and measurable success criteria.',
            'Surface tradeoffs between scope, speed, and reliability.',
            'Prefer narrow shipped value over speculative surface area.',
        ],
        outputs: ['PRD delta', 'scope cut list', 'success criteria'],
        guardrails: ['Do not hide dependencies.', 'Always state assumptions explicitly.'],
    },
    {
        domain: 'backend',
        noun: 'backend delivery',
        instructions: [
            'Prioritize runtime correctness, migrations, and operational safety.',
            'Call out data contracts, rollback paths, and verification commands.',
            'Prefer additive interfaces and guarded rollouts.',
        ],
        outputs: ['API contract notes', 'migration checklist', 'verification plan'],
        guardrails: ['Do not bypass verification.', 'Do not silently change contracts.'],
    },
    {
        domain: 'frontend',
        noun: 'frontend delivery',
        instructions: [
            'Preserve interaction intent and loading/error states.',
            'Check layout behavior on desktop and mobile.',
            'Prefer auditable UI states over decorative complexity.',
        ],
        outputs: ['UI acceptance notes', 'state coverage list', 'dashboard copy'],
        guardrails: ['Do not regress accessibility.', 'Do not ship hidden loading failures.'],
    },
    {
        domain: 'sales',
        noun: 'sales enablement',
        instructions: [
            'Convert technical capability into buyer outcomes, objections, and proof.',
            'Keep claims concrete and tied to the shipped runtime.',
            'Highlight deployment friction, time-to-value, and expansion paths.',
        ],
        outputs: ['objection matrix', 'value narrative', 'demo outline'],
        guardrails: ['Do not fabricate ROI.', 'Do not claim unsupported integrations.'],
    },
    {
        domain: 'finance',
        noun: 'finance readiness',
        instructions: [
            'Track cost, ROI signals, and operational efficiency of agent work.',
            'Prefer evidence-backed efficiency claims.',
            'Watch token, compute, and verification cost trends.',
        ],
        outputs: ['cost model notes', 'savings estimate', 'risk summary'],
        guardrails: ['Do not invent budget numbers.', 'Mark estimates as estimates.'],
    },
    {
        domain: 'workflows',
        noun: 'workflow orchestration',
        instructions: [
            'Express repeatable task graphs with checkpoints, outputs, and handoff rules.',
            'Prefer explicit role ownership and verifier steps.',
            'Make workflow promotion evidence-based.',
        ],
        outputs: ['workflow graph', 'checkpoint list', 'handoff contract'],
        guardrails: ['Do not skip handoff validation.', 'Do not mix mutation and approval in one opaque step.'],
    },
    {
        domain: 'orchestration',
        noun: 'multi-agent orchestration',
        instructions: [
            'Balance worker parallelism against merge and verification cost.',
            'Use planner, coder, verifier, and skill-maker roles deliberately.',
            'Escalate conflicts to consensus rather than forcing a winner.',
        ],
        outputs: ['worker assignment map', 'consensus notes', 'retry policy'],
        guardrails: ['Do not duplicate worker scope.', 'Do not promote unverified skills.'],
    },
];

export const BUILTIN_SKILL_PACKS: DomainSkillSeed[] = BASE_DOMAIN_SKILLS.flatMap((seed) => ([
    {
        key: `${seed.domain}-playbook`,
        name: `${seed.domain}-playbook`,
        domain: seed.domain,
        description: `Bundled ${seed.domain} playbook for ${seed.noun}.`,
        riskClass: 'orchestrate',
        scope: 'base',
        instructions: [
            `Operate as the ${seed.domain} specialist for this run.`,
            ...seed.instructions,
        ],
        triggerConditions: [`goal mentions ${seed.domain}`, `${seed.domain} workflow requested explicitly`],
        expectedOutputs: seed.outputs,
        guardrails: seed.guardrails,
        verifierHooks: ['Record what changed and how it was verified.'],
        roleAffinity: ['planner', 'coder', 'skill-maker'],
        toolBindings: [],
    },
    {
        key: `${seed.domain}-reviewer`,
        name: `${seed.domain}-reviewer`,
        domain: seed.domain,
        description: `Bundled ${seed.domain} reviewer for evidence-backed output review.`,
        riskClass: 'read',
        scope: 'base',
        instructions: [
            `Review ${seed.domain} outputs for accuracy, credibility, and completeness.`,
            'Look for unstated assumptions and unsupported claims.',
            'Produce short reviewer notes with concrete risks.',
        ],
        triggerConditions: [`${seed.domain} output exists`, `run enters verification`],
        expectedOutputs: ['review notes', 'risk list'],
        guardrails: ['Do not approve outputs without evidence.', ...seed.guardrails],
        verifierHooks: ['Review output against runtime artifacts before promotion.'],
        roleAffinity: ['verifier', 'research-shadow'],
        toolBindings: [],
    },
]));

export const BUILTIN_WORKFLOW_PACKS: DomainWorkflowSeed[] = BASE_DOMAIN_SKILLS.map((seed) => ({
    key: `${seed.domain}-execution-loop`,
    name: `${seed.domain}-execution-loop`,
    domain: seed.domain,
    description: `Bundled ${seed.domain} workflow with planning, execution, and verification checkpoints.`,
    triggerConditions: [`goal mentions ${seed.domain}`, `${seed.domain} pack selected`],
    expectedOutputs: seed.outputs,
    guardrails: seed.guardrails,
    verifierHooks: ['Collect verifier evidence before workflow promotion.'],
    roleAffinity: ['planner', 'coder', 'verifier', 'skill-maker'],
    steps: [
        {
            title: `Plan ${seed.domain} outcome and artifacts`,
            checkpoint: 'before-read',
            role: 'planner',
        },
        {
            title: `Execute ${seed.domain} changes with bounded scope`,
            checkpoint: 'before-mutate',
            role: 'coder',
        },
        {
            title: `Review ${seed.domain} outputs and attach evidence`,
            checkpoint: 'before-verify',
            role: 'verifier',
        },
    ],
}));

export function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'artifact';
}

export function detectDomains(text: string, extra: string[] = []): string[] {
    const haystack = `${text} ${extra.join(' ')}`.toLowerCase();
    const matched = new Set<string>();
    for (const seed of BASE_DOMAIN_SKILLS) {
        if (haystack.includes(seed.domain) || haystack.includes(seed.noun.split(' ')[0])) {
            matched.add(seed.domain);
        }
    }

    if (matched.size === 0 && /(launch|messaging|gtm|copy|positioning)/.test(haystack)) matched.add('marketing');
    if (matched.size === 0 && /(roadmap|spec|scope|product)/.test(haystack)) matched.add('product');
    if (matched.size === 0 && /(api|server|database|migration|backend)/.test(haystack)) matched.add('backend');
    if (matched.size === 0 && /(ui|ux|dashboard|frontend|react)/.test(haystack)) matched.add('frontend');
    if (matched.size === 0 && /(pricing|buyer|sales|pipeline)/.test(haystack)) matched.add('sales');
    if (matched.size === 0 && /(budget|cost|roi|finance)/.test(haystack)) matched.add('finance');
    if (matched.size === 0 && /(workflow|playbook|runbook)/.test(haystack)) matched.add('workflows');
    if (matched.size === 0 && /(swarm|orchestr|agent|parallel)/.test(haystack)) matched.add('orchestration');

    return [...matched];
}

export function readMarkdownArtifacts(dir: string): Array<{ path: string; parsed: ParsedMarkdownArtifact }> {
    if (!fs.existsSync(dir)) return [];
    return walkMarkdown(dir).map((filePath) => ({
        path: filePath,
        parsed: parseMarkdownArtifact(fs.readFileSync(filePath, 'utf-8')),
    }));
}

export function parseMarkdownArtifact(raw: string): ParsedMarkdownArtifact {
    if (!raw.startsWith('---')) {
        return { frontmatter: {}, body: raw.trim() };
    }

    const end = raw.indexOf('\n---', 3);
    if (end === -1) {
        return { frontmatter: {}, body: raw.trim() };
    }

    const yamlBlock = raw.slice(3, end).trim();
    return {
        frontmatter: parseLooseYaml(yamlBlock),
        body: raw.slice(end + 4).trim(),
    };
}

function walkMarkdown(dir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...walkMarkdown(target));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            found.push(target);
        }
    }
    return found;
}

function parseLooseYaml(raw: string): Record<string, unknown> {
    const parsed: Record<string, unknown> = {};
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf(':');
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (value.startsWith('[') && value.endsWith(']')) {
            parsed[key] = value
                .slice(1, -1)
                .split(',')
                .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
                .filter(Boolean);
        } else {
            parsed[key] = value.replace(/^['"]|['"]$/g, '');
        }
    }
    return parsed;
}
