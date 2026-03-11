import * as fs from 'fs';
import * as path from 'path';

export type SkillRiskClass = 'read' | 'orchestrate' | 'mutate';
export type SkillScope = 'base' | 'session' | 'worker' | 'runtime-hot' | 'global';
export type SkillCheckpoint = 'before-read' | 'before-mutate' | 'before-verify' | 'retry';
export type HookTrigger =
    | 'run.created'
    | 'before-read'
    | 'before-mutate'
    | 'before-verify'
    | 'retry'
    | 'run.failed'
    | 'run.verified'
    | 'promotion.approved'
    | 'memory.stored'
    | 'shield.blocked';
export type AutomationTriggerMode = 'event' | 'schedule' | 'connector';
export type ConnectorKind = 'github' | 'http';

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
    promotionThresholds?: {
        minSuccesses: number;
        maxFailures: number;
    };
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
    promotionThresholds?: {
        minSuccesses: number;
        maxFailures: number;
    };
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
    roleAffinity: string[];
    verifierHooks: string[];
    toolBindings: RuntimeBinding[];
    builderRiskClass?: SkillRiskClass;
}> = [
    {
        domain: 'pdlc',
        noun: 'product development lifecycle',
        instructions: [
            'Plan discovery, delivery, launch, feedback, and iteration as one lifecycle.',
            'Translate goals into milestones, acceptance criteria, and checkpoint ownership.',
            'Prefer measurable outcomes over vague roadmap language.',
        ],
        outputs: ['delivery plan', 'release checklist', 'feedback loop'],
        guardrails: ['Do not hide milestone risk.', 'Do not collapse planning and approval into one step.'],
        roleAffinity: ['planner', 'coder', 'verifier'],
        verifierHooks: ['Record lifecycle checkpoint evidence before promotion.'],
        toolBindings: [],
    },
    {
        domain: 'gtm',
        noun: 'go-to-market execution',
        instructions: [
            'Translate launch work into audience, channel, offer, proof, and timing.',
            'Keep GTM plans tied to shipped capability rather than aspirational copy.',
            'Map launch work to concrete owners and deadlines.',
        ],
        outputs: ['launch plan', 'channel matrix', 'proof checklist'],
        guardrails: ['Do not invent traction.', 'Mark roadmap items as roadmap items.'],
        roleAffinity: ['planner', 'skill-maker', 'verifier'],
        verifierHooks: ['Validate launch claims against shipped runtime artifacts.'],
        toolBindings: [],
    },
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
        roleAffinity: ['planner', 'skill-maker', 'verifier'],
        verifierHooks: ['Check messaging against live product behavior before promotion.'],
        toolBindings: [],
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
        roleAffinity: ['planner', 'coder', 'verifier'],
        verifierHooks: ['Attach scope and dependency evidence to the run ledger.'],
        toolBindings: [],
    },
    {
        domain: 'writing',
        noun: 'editorial synthesis',
        instructions: [
            'Condense research, runtime evidence, and technical detail into clear prose.',
            'Prefer crisp, verifiable writing over filler or hype.',
            'Keep audience and decision context explicit.',
        ],
        outputs: ['brief', 'summary', 'editorial draft'],
        guardrails: ['Do not fabricate quotes.', 'Do not mask uncertainty.'],
        roleAffinity: ['planner', 'skill-maker', 'research-shadow'],
        verifierHooks: ['Check important claims against source artifacts.'],
        toolBindings: [],
    },
    {
        domain: 'deep-tech',
        noun: 'research synthesis',
        instructions: [
            'Break hard technical problems into assumptions, experiments, and edge cases.',
            'Capture evidence, tradeoffs, and failure modes explicitly.',
            'Keep research findings connected to implementation decisions.',
        ],
        outputs: ['research note', 'experiment plan', 'decision matrix'],
        guardrails: ['Do not treat speculation as evidence.', 'Separate hypothesis from result.'],
        roleAffinity: ['research-shadow', 'planner', 'verifier'],
        verifierHooks: ['Link research conclusions to concrete artifacts or measurements.'],
        toolBindings: [],
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
        roleAffinity: ['planner', 'coder', 'verifier'],
        verifierHooks: ['Record changed contracts and rollback paths.'],
        toolBindings: [{ type: 'run_command', command: 'npm test' }],
        builderRiskClass: 'mutate',
    },
    {
        domain: 'api',
        noun: 'API design and integration',
        instructions: [
            'Keep interface shape, versioning, and failure modes explicit.',
            'Prefer additive contracts and explicit deprecations.',
            'Document request, response, and verification expectations together.',
        ],
        outputs: ['contract delta', 'consumer impact note', 'verification matrix'],
        guardrails: ['Do not silently break clients.', 'Do not blur request validation rules.'],
        roleAffinity: ['planner', 'coder', 'verifier'],
        verifierHooks: ['Check contract examples against implementation artifacts.'],
        toolBindings: [],
    },
    {
        domain: 'data',
        noun: 'data and state management',
        instructions: [
            'Model storage, migration, retention, and observability together.',
            'Prefer reversible changes and explicit ownership of state transitions.',
            'Track integrity and cleanup paths before rollout.',
        ],
        outputs: ['schema note', 'retention checklist', 'integrity plan'],
        guardrails: ['Do not mutate state without rollback.', 'Do not ignore migration verification.'],
        roleAffinity: ['planner', 'coder', 'verifier'],
        verifierHooks: ['Attach migration or persistence verification evidence.'],
        toolBindings: [],
    },
    {
        domain: 'python',
        noun: 'python application delivery',
        instructions: [
            'Favor explicit environments, reproducible commands, and test-backed changes.',
            'Call out dependency, packaging, and runtime assumptions.',
            'Prefer typed, readable service boundaries over implicit magic.',
        ],
        outputs: ['implementation note', 'env checklist', 'test matrix'],
        guardrails: ['Do not change runtime dependencies silently.', 'Do not skip test isolation.'],
        roleAffinity: ['planner', 'coder', 'verifier'],
        verifierHooks: ['Run or document Python verification commands before promotion.'],
        toolBindings: [{ type: 'run_command', command: 'python -m pytest' }],
        builderRiskClass: 'mutate',
    },
    {
        domain: 'django',
        noun: 'django backend delivery',
        instructions: [
            'Treat models, migrations, admin, and public API surface as one system.',
            'Verify settings, migrations, and management commands explicitly.',
            'Preserve safe defaults for auth, forms, and data access.',
        ],
        outputs: ['migration review', 'settings checklist', 'endpoint review'],
        guardrails: ['Do not ship unchecked migrations.', 'Do not loosen auth without review.'],
        roleAffinity: ['planner', 'coder', 'verifier'],
        verifierHooks: ['Require migration and endpoint verification evidence.'],
        toolBindings: [{ type: 'run_command', command: 'python manage.py check' }],
        builderRiskClass: 'mutate',
    },
    {
        domain: 'typescript',
        noun: 'typed TypeScript delivery',
        instructions: [
            'Use explicit types to protect contracts, orchestration, and runtime safety.',
            'Prefer additive interfaces and deterministic serialization.',
            'Surface compile-time tradeoffs before broad refactors.',
        ],
        outputs: ['type contract note', 'refactor checklist', 'compile verification plan'],
        guardrails: ['Do not use types to hide runtime ambiguity.', 'Do not widen contracts casually.'],
        roleAffinity: ['planner', 'coder', 'verifier'],
        verifierHooks: ['Capture type-check or build evidence when relevant.'],
        toolBindings: [{ type: 'run_command', command: 'npm run build' }],
        builderRiskClass: 'mutate',
    },
    {
        domain: 'node',
        noun: 'Node.js runtime delivery',
        instructions: [
            'Balance runtime correctness, dependency safety, and operational visibility.',
            'Keep scripts, CLIs, and servers explicit about side effects.',
            'Use bounded commands and deterministic outputs wherever possible.',
        ],
        outputs: ['runtime note', 'command contract', 'operational checklist'],
        guardrails: ['Do not hide side effects in scripts.', 'Do not ship unverifiable command paths.'],
        roleAffinity: ['planner', 'coder', 'verifier'],
        verifierHooks: ['Confirm command contracts with real output evidence.'],
        toolBindings: [{ type: 'run_command', command: 'node -e "process.exit(0)"' }],
        builderRiskClass: 'mutate',
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
        roleAffinity: ['planner', 'coder', 'verifier'],
        verifierHooks: ['Review loading, error, and mobile states against the shipped UI.'],
        toolBindings: [],
        builderRiskClass: 'mutate',
    },
    {
        domain: 'react',
        noun: 'React application delivery',
        instructions: [
            'Keep state flow, rendering intent, and hydration behavior explicit.',
            'Preserve loading, error, and empty states as first-class product surfaces.',
            'Prefer composable primitives and measurable UX improvements.',
        ],
        outputs: ['component plan', 'state coverage note', 'interaction checklist'],
        guardrails: ['Do not hide hydration failures.', 'Do not regress accessibility or responsiveness.'],
        roleAffinity: ['planner', 'coder', 'verifier'],
        verifierHooks: ['Capture UI state verification evidence before promotion.'],
        toolBindings: [],
        builderRiskClass: 'mutate',
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
        roleAffinity: ['planner', 'skill-maker', 'verifier'],
        verifierHooks: ['Validate sales claims against product and deployment evidence.'],
        toolBindings: [],
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
        roleAffinity: ['planner', 'research-shadow', 'verifier'],
        verifierHooks: ['Require evidence for savings and efficiency claims.'],
        toolBindings: [],
    },
    {
        domain: 'economics',
        noun: 'economic systems analysis',
        instructions: [
            'Model cost, incentives, pricing, and market dynamics as a system.',
            'Separate assumptions, scenarios, and measured outcomes.',
            'Translate technical change into economic effects carefully.',
        ],
        outputs: ['economic model note', 'scenario table', 'sensitivity summary'],
        guardrails: ['Do not present modeled outcomes as observed truth.', 'Make assumptions explicit.'],
        roleAffinity: ['planner', 'research-shadow', 'verifier'],
        verifierHooks: ['Flag unsupported economic claims before promotion.'],
        toolBindings: [],
    },
    {
        domain: 'ai',
        noun: 'AI systems delivery',
        instructions: [
            'Treat prompts, evaluations, model behavior, and guardrails as one runtime system.',
            'Capture failure classes, test prompts, and evidence-backed quality measures.',
            'Prefer explicit evaluation loops over anecdotal claims.',
        ],
        outputs: ['evaluation plan', 'prompt/system note', 'failure taxonomy'],
        guardrails: ['Do not claim model quality without evaluation evidence.', 'Do not hide unsafe prompt/tool paths.'],
        roleAffinity: ['planner', 'coder', 'research-shadow', 'verifier'],
        verifierHooks: ['Attach evaluation evidence and failure notes before promotion.'],
        toolBindings: [],
        builderRiskClass: 'mutate',
    },
    {
        domain: 'security',
        noun: 'security and compliance review',
        instructions: [
            'Check secret handling, privilege boundaries, and unsafe execution paths.',
            'Prefer secure defaults and explicit risk classification.',
            'Escalate sensitive findings with concrete remediation steps.',
        ],
        outputs: ['risk register', 'security checklist', 'mitigation note'],
        guardrails: ['Do not ignore secret exposure.', 'Do not approve unsafe command paths.'],
        roleAffinity: ['verifier', 'research-shadow', 'planner'],
        verifierHooks: ['Run a final risk pass before promotion or transmission.'],
        toolBindings: [],
    },
    {
        domain: 'design',
        noun: 'design systems and brand quality',
        instructions: [
            'Translate goals into usable, coherent, and visually intentional interfaces.',
            'Preserve accessibility, hierarchy, and implementation realism together.',
            'Prefer system-level design guidance over isolated visual tweaks.',
        ],
        outputs: ['design brief', 'UX notes', 'visual QA checklist'],
        guardrails: ['Do not prioritize aesthetics over usability.', 'Do not ignore implementation constraints.'],
        roleAffinity: ['planner', 'verifier', 'research-shadow'],
        verifierHooks: ['Review interaction, hierarchy, and accessibility before promotion.'],
        toolBindings: [],
    },
    {
        domain: 'testing',
        noun: 'quality assurance and evidence collection',
        instructions: [
            'Treat verification, evidence, and failure reproduction as first-class outputs.',
            'Prefer reproducible checks and explicit acceptance criteria.',
            'Turn vague bugs into concrete failing scenarios.',
        ],
        outputs: ['test evidence', 'acceptance checklist', 'failure report'],
        guardrails: ['Do not certify without evidence.', 'Do not hide failing cases.'],
        roleAffinity: ['verifier', 'planner', 'research-shadow'],
        verifierHooks: ['Attach evidence-backed QA results before promotion.'],
        toolBindings: [],
    },
    {
        domain: 'support',
        noun: 'support and operational follow-through',
        instructions: [
            'Translate system changes into user-visible support impact and follow-up actions.',
            'Capture operator, customer, and incident-facing consequences.',
            'Prefer crisp operational guidance over internal jargon.',
        ],
        outputs: ['support note', 'incident summary', 'operator checklist'],
        guardrails: ['Do not invent customer outcomes.', 'Do not hide operational risk.'],
        roleAffinity: ['planner', 'verifier', 'skill-maker'],
        verifierHooks: ['Confirm support-facing guidance against actual runtime behavior.'],
        toolBindings: [],
    },
    {
        domain: 'strategy',
        noun: 'strategic framing and decision support',
        instructions: [
            'Frame tradeoffs, options, and consequences clearly before broad commitments.',
            'Connect execution decisions to product and business outcomes.',
            'Prefer explicit assumptions and scenarios over vague strategy language.',
        ],
        outputs: ['strategy memo', 'options matrix', 'decision brief'],
        guardrails: ['Do not present assumptions as facts.', 'Do not bury downside scenarios.'],
        roleAffinity: ['planner', 'research-shadow', 'verifier'],
        verifierHooks: ['Require explicit assumptions and evidence references.'],
        toolBindings: [],
    },
    {
        domain: 'paid-media',
        noun: 'paid media and acquisition systems',
        instructions: [
            'Connect campaign structure, measurement, creative, and economics in one operating view.',
            'Keep channel and attribution claims evidence-based.',
            'Prefer scalable acquisition systems over channel-specific tricks.',
        ],
        outputs: ['channel plan', 'measurement checklist', 'acquisition review'],
        guardrails: ['Do not invent channel performance.', 'Do not separate creative claims from measurement evidence.'],
        roleAffinity: ['planner', 'research-shadow', 'verifier'],
        verifierHooks: ['Flag unsupported acquisition and attribution claims.'],
        toolBindings: [],
    },
    {
        domain: 'game-development',
        noun: 'game systems and content delivery',
        instructions: [
            'Treat gameplay systems, engine constraints, and player experience as one product surface.',
            'Capture content pipeline, performance, and iteration constraints explicitly.',
            'Prefer reproducible engine guidance over generic creative advice.',
        ],
        outputs: ['game systems note', 'engine checklist', 'content pipeline review'],
        guardrails: ['Do not ignore engine constraints.', 'Do not separate design from implementation feasibility.'],
        roleAffinity: ['planner', 'coder', 'verifier'],
        verifierHooks: ['Capture engine-specific constraints and validation evidence.'],
        toolBindings: [],
        builderRiskClass: 'mutate',
    },
    {
        domain: 'spatial-computing',
        noun: 'spatial and immersive experience delivery',
        instructions: [
            'Treat performance, interaction, and environment constraints as first-class design inputs.',
            'Keep platform-specific assumptions explicit.',
            'Prefer embodied interaction quality over flat-screen metaphors.',
        ],
        outputs: ['spatial interaction brief', 'platform checklist', 'performance note'],
        guardrails: ['Do not ignore spatial platform constraints.', 'Do not ship immersive claims without platform evidence.'],
        roleAffinity: ['planner', 'coder', 'verifier'],
        verifierHooks: ['Capture platform and performance evidence before promotion.'],
        toolBindings: [],
        builderRiskClass: 'mutate',
    },
    {
        domain: 'integrations',
        noun: 'integration and toolchain coordination',
        instructions: [
            'Treat setup, interoperability, and failure modes as part of the feature, not afterthoughts.',
            'Prefer explicit connector contracts and setup evidence.',
            'Keep integration guidance grounded in actual supported paths.',
        ],
        outputs: ['integration note', 'setup checklist', 'connector contract'],
        guardrails: ['Do not claim unsupported integrations.', 'Do not hide connector prerequisites.'],
        roleAffinity: ['planner', 'coder', 'verifier'],
        verifierHooks: ['Check integration guidance against actual runtime and docs surfaces.'],
        toolBindings: [],
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
        roleAffinity: ['planner', 'coder', 'verifier', 'skill-maker'],
        verifierHooks: ['Record workflow evidence before global promotion.'],
        toolBindings: [],
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
        roleAffinity: ['planner', 'coder', 'verifier', 'skill-maker', 'research-shadow'],
        verifierHooks: ['Attach merge and promotion evidence to the run ledger.'],
        toolBindings: [],
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
        verifierHooks: seed.verifierHooks,
        roleAffinity: seed.roleAffinity,
        toolBindings: [],
        promotionThresholds: { minSuccesses: 2, maxFailures: 1 },
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
        verifierHooks: ['Review output against runtime artifacts before promotion.', ...seed.verifierHooks],
        roleAffinity: ['verifier', 'research-shadow'],
        toolBindings: [],
        promotionThresholds: { minSuccesses: 2, maxFailures: 1 },
    },
    {
        key: `${seed.domain}-builder`,
        name: `${seed.domain}-builder`,
        domain: seed.domain,
        description: `Bundled ${seed.domain} builder/operator for bounded implementation work.`,
        riskClass: seed.builderRiskClass ?? 'orchestrate',
        scope: 'base',
        instructions: [
            `Operate as the ${seed.domain} builder with bounded mutations and verifier discipline.`,
            'Keep changes scoped, explicit, and reversible.',
            'Attach implementation evidence before promotion.',
        ],
        triggerConditions: [`${seed.domain} mutation requested`, `${seed.domain} implementation work detected`],
        expectedOutputs: ['implementation delta', 'verification evidence'],
        guardrails: ['Do not mutate outside assigned scope.', ...seed.guardrails],
        verifierHooks: seed.verifierHooks,
        roleAffinity: ['coder', 'verifier'],
        toolBindings: seed.toolBindings,
        promotionThresholds: { minSuccesses: 2, maxFailures: 1 },
    },
]));

export const BUILTIN_WORKFLOW_PACKS: DomainWorkflowSeed[] = BASE_DOMAIN_SKILLS.flatMap((seed) => ([
    {
        key: `${seed.domain}-execution-loop`,
        name: `${seed.domain}-execution-loop`,
        domain: seed.domain,
        description: `Bundled ${seed.domain} workflow with planning, execution, and verification checkpoints.`,
        triggerConditions: [`goal mentions ${seed.domain}`, `${seed.domain} pack selected`],
        expectedOutputs: seed.outputs,
        guardrails: seed.guardrails,
        verifierHooks: ['Collect verifier evidence before workflow promotion.', ...seed.verifierHooks],
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
        promotionThresholds: { minSuccesses: 2, maxFailures: 1 },
    },
    {
        key: `${seed.domain}-approval-loop`,
        name: `${seed.domain}-approval-loop`,
        domain: seed.domain,
        description: `Bundled ${seed.domain} approval loop with review, verification, and promotion control.`,
        triggerConditions: [`${seed.domain} approval requested`, `${seed.domain} promotion under review`],
        expectedOutputs: ['approval note', 'review evidence', 'promotion decision'],
        guardrails: ['Do not approve unverified work.', ...seed.guardrails],
        verifierHooks: ['Require approval evidence before promotion.', ...seed.verifierHooks],
        roleAffinity: ['planner', 'verifier', 'research-shadow'],
        steps: [
            {
                title: `Frame ${seed.domain} approval criteria`,
                checkpoint: 'before-read',
                role: 'planner',
            },
            {
                title: `Review ${seed.domain} evidence and risks`,
                checkpoint: 'before-verify',
                role: 'verifier',
            },
            {
                title: `Publish ${seed.domain} approval outcome`,
                checkpoint: 'retry',
                role: 'research-shadow',
            },
        ],
        promotionThresholds: { minSuccesses: 2, maxFailures: 1 },
    },
]));

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

    if (matched.size === 0 && /(pdlc|lifecycle|milestone|release loop)/.test(haystack)) matched.add('pdlc');
    if (matched.size === 0 && /(go-to-market|gtm|launch campaign|channel)/.test(haystack)) matched.add('gtm');
    if (matched.size === 0 && /(launch|messaging|copy|positioning)/.test(haystack)) matched.add('marketing');
    if (matched.size === 0 && /(roadmap|spec|scope|product)/.test(haystack)) matched.add('product');
    if (matched.size === 0 && /(write|writing|editorial|brief|synthesis)/.test(haystack)) matched.add('writing');
    if (matched.size === 0 && /(research|deep-tech|paper|experiment)/.test(haystack)) matched.add('deep-tech');
    if (matched.size === 0 && /(api|server|database|migration|backend)/.test(haystack)) matched.add('backend');
    if (matched.size === 0 && /(endpoint|contract|schema|integration)/.test(haystack)) matched.add('api');
    if (matched.size === 0 && /(data|warehouse|etl|state|retention)/.test(haystack)) matched.add('data');
    if (matched.size === 0 && /(python|pytest|pip|venv)/.test(haystack)) matched.add('python');
    if (matched.size === 0 && /(django|manage\\.py|orm|model)/.test(haystack)) matched.add('django');
    if (matched.size === 0 && /(typescript|tsconfig|types)/.test(haystack)) matched.add('typescript');
    if (matched.size === 0 && /(node|nodejs|node\\.js|cli)/.test(haystack)) matched.add('node');
    if (matched.size === 0 && /(ui|ux|dashboard|frontend)/.test(haystack)) matched.add('frontend');
    if (matched.size === 0 && /(react|jsx|hooks|component)/.test(haystack)) matched.add('react');
    if (matched.size === 0 && /(pricing|buyer|sales|pipeline)/.test(haystack)) matched.add('sales');
    if (matched.size === 0 && /(budget|cost|roi|finance)/.test(haystack)) matched.add('finance');
    if (matched.size === 0 && /(economic|economics|pricing model|incentive)/.test(haystack)) matched.add('economics');
    if (matched.size === 0 && /(ai|model|prompt|evaluation|llm)/.test(haystack)) matched.add('ai');
    if (matched.size === 0 && /(security|secret|risk|compliance|auth)/.test(haystack)) matched.add('security');
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
