import type { ExecutionTask } from '../phantom/runtime.js';
import {
    type ContinuationProposal,
    type CrewTemplate,
    type FallbackPlan,
    type OptimizationProfile,
    type PlanningLedgerRow,
    type ReviewGateResult,
    type SelectedCrew,
    type SelectedSpecialist,
    type ToolPolicyDecision,
    listCrewTemplates,
    planSpecialists,
} from './specialist-roster.js';

export interface TaskPlannerState {
    objective: string;
    optimizationProfile: OptimizationProfile;
    selectedCrew: SelectedCrew;
    selectedSpecialists: SelectedSpecialist[];
    selectedSkills: string[];
    selectedWorkflows: string[];
    toolPolicy: ToolPolicyDecision;
    swarmDecision: {
        mode: 'sequential' | 'bounded-parallel' | 'max';
        workers: number;
        rationale: string;
    };
    fallbackPlan: FallbackPlan;
    reviewGates: ReviewGateResult[];
    continuation: ContinuationProposal;
    ledger: PlanningLedgerRow[];
    crewCatalog: CrewTemplate[];
}

export interface TaskPlannerOutput {
    task: ExecutionTask;
    plannerState: TaskPlannerState;
}

export function planTask(task: ExecutionTask): TaskPlannerOutput {
    if (process.env.NEXUS_SPECIALIST_PLANNER_DISABLED === '1') {
        return {
            task,
            plannerState: {
                objective: task.goal,
                optimizationProfile: task.optimizationProfile ?? 'standard',
                selectedCrew: {
                    crewId: 'crew_baseline',
                    name: 'Baseline Runtime',
                    summary: 'Specialist planner overlay disabled; current runtime path remains active.',
                    domains: [],
                    confidence: { score: 1, reasons: ['Planner overlay disabled by configuration.'] },
                },
                selectedSpecialists: [],
                selectedSkills: task.skillNames,
                selectedWorkflows: task.workflowSelectors,
                toolPolicy: {
                    allowedTools: task.allowedToolsOverride ?? ['read_file', 'run_command'],
                    reasons: ['Planner overlay disabled; preserved current runtime tool policy.'],
                },
                swarmDecision: {
                    mode: 'sequential',
                    workers: task.workers,
                    rationale: 'Planner overlay disabled; preserved current runtime execution path.',
                },
                fallbackPlan: {
                    summary: 'Current runtime domain-pack execution remains the active path.',
                    steps: ['Keep the pre-overlay runtime flow active until the planner overlay is re-enabled.'],
                },
                reviewGates: [],
                continuation: {
                    summary: 'Continuation planning is disabled with the planner overlay.',
                    suggestedActions: [],
                    automationCandidates: [],
                },
                ledger: [{
                    stage: 'planner-overlay',
                    status: 'fallback',
                    owner: 'task-planner',
                    selectedAssets: ['baseline-runtime'],
                    notes: 'Specialist planner overlay disabled by NEXUS_SPECIALIST_PLANNER_DISABLED=1.',
                }],
                crewCatalog: listCrewTemplates(),
            },
        };
    }

    const optimizationProfile = task.optimizationProfile ?? 'standard';
    const specialistPlan = planSpecialists({
        goal: task.goal,
        files: task.files,
        requestedCrews: task.crewSelectors,
        requestedSpecialists: task.specialistSelectors,
        requestedSkills: task.skillNames,
        requestedWorkflows: task.workflowSelectors,
        optimizationProfile,
    });
    const resolvedToolPolicy = plannerToolPolicy(specialistPlan.toolPolicy, task);
    const specialistConfidence = specialistPlan.selectedSpecialists.length > 0
        ? specialistPlan.selectedSpecialists.reduce((sum, specialist) => sum + specialist.confidence.score, 0) / specialistPlan.selectedSpecialists.length
        : 0;
    const plannerConfident = specialistPlan.selectedCrew.confidence.score >= 0.24 && specialistConfidence >= 0.18;

    const workers = plannerConfident
        ? decideWorkers(task.workers, specialistPlan.selectedSpecialists.length, optimizationProfile, task.files.length)
        : task.workers;
    const swarmDecision = {
        mode: !plannerConfident
            ? 'sequential'
            : optimizationProfile === 'max'
                ? 'max'
                : workers > 2
                    ? 'bounded-parallel'
                    : 'sequential',
        workers,
        rationale: !plannerConfident
            ? 'Planner confidence stayed below the non-regression threshold, so Nexus fell back to the current sequential runtime path.'
            : optimizationProfile === 'max'
                ? 'Max profile expands specialist exploration and bounded swarm evaluation.'
                : workers > 2
                    ? 'Planner selected bounded parallelism due to specialist breadth or file count.'
                    : 'Planner stayed on the sequential path to preserve current responsiveness and quality.',
    } as const;

    const taskWithPlannerSelections: ExecutionTask = {
        ...task,
        workers: workers,
        skillNames: plannerConfident
            ? dedupeStrings([...specialistPlan.selectedSkills, ...task.skillNames])
            : task.skillNames,
        workflowSelectors: plannerConfident
            ? dedupeStrings([...specialistPlan.selectedWorkflows, ...task.workflowSelectors])
            : task.workflowSelectors,
        roles: dedupeStrings([
            'planner',
            ...task.roles,
            ...(plannerConfident && specialistPlan.selectedSpecialists.some((entry) => entry.authority === 'mutate') ? ['coder'] : []),
            ...(plannerConfident && specialistPlan.selectedSpecialists.some((entry) => entry.authority !== 'mutate') ? ['verifier'] : []),
        ]),
        allowedToolsOverride: plannerConfident
            ? resolvedToolPolicy.allowedTools
            : task.allowedToolsOverride,
    };

    const plannerState: TaskPlannerState = {
        objective: task.goal,
        optimizationProfile,
        selectedCrew: specialistPlan.selectedCrew,
        selectedSpecialists: specialistPlan.selectedSpecialists,
        selectedSkills: specialistPlan.selectedSkills,
        selectedWorkflows: specialistPlan.selectedWorkflows,
        toolPolicy: resolvedToolPolicy,
        swarmDecision,
        fallbackPlan: specialistPlan.fallbackPlan,
        reviewGates: specialistPlan.reviewGates,
        continuation: specialistPlan.continuation,
        ledger: [
            ...specialistPlan.ledger,
            {
                stage: 'confidence-check',
                status: plannerConfident ? 'completed' : 'fallback',
                owner: 'task-planner',
                selectedAssets: [
                    `crew:${specialistPlan.selectedCrew.name}`,
                    `specialists:${specialistPlan.selectedSpecialists.length}`,
                    `avg:${specialistConfidence.toFixed(2)}`,
                ],
                notes: plannerConfident
                    ? 'Planner confidence cleared the overlay threshold.'
                    : 'Planner confidence was low, so the stable baseline runtime path remains active.',
            },
            {
                stage: 'swarm-decision',
                status: 'completed',
                owner: 'swarm-planner',
                selectedAssets: [swarmDecision.mode, `${swarmDecision.workers} workers`],
                notes: swarmDecision.rationale,
            },
        ],
        crewCatalog: listCrewTemplates(),
    };

    return {
        task: taskWithPlannerSelections,
        plannerState,
    };
}

function decideWorkers(requestedWorkers: number, specialistCount: number, optimizationProfile: OptimizationProfile, fileCount: number): number {
    if (optimizationProfile === 'max') return Math.max(requestedWorkers, Math.min(7, Math.max(3, specialistCount)));
    if (specialistCount <= 2 && fileCount <= 2) return Math.min(requestedWorkers, 2);
    return Math.max(requestedWorkers, Math.min(4, Math.max(2, Math.ceil(specialistCount / 2))));
}

function dedupeStrings(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function plannerToolPolicy(toolPolicy: ToolPolicyDecision, task: ExecutionTask): ToolPolicyDecision {
    const explicitActionTools = dedupeStrings(task.actions.map((action) => action.type));
    if (explicitActionTools.length === 0) {
        return toolPolicy;
    }

    return {
        allowedTools: dedupeStrings([...toolPolicy.allowedTools, ...explicitActionTools]),
        reasons: dedupeStrings([
            ...toolPolicy.reasons,
            'Explicit runtime actions expanded the allowed tool set to preserve current execution behavior.',
        ]),
    };
}
