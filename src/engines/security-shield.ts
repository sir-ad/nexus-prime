import { randomUUID } from 'crypto';
import type { RuntimeBinding, SkillRiskClass } from './runtime-assets.js';
import type { ConnectorBinding } from './automation-runtime.js';

export type ShieldPolicyMode = 'balanced' | 'strict' | 'permissive';
export type ShieldSeverity = 'low' | 'medium' | 'high';
export type ShieldAction = 'allow' | 'warn' | 'quarantine' | 'block';
export type ShieldStage = 'apply' | 'promotion' | 'connector' | 'memory';

export interface ShieldFinding {
    id: string;
    severity: ShieldSeverity;
    message: string;
    evidence: string[];
}

export interface ShieldDecision {
    decisionId: string;
    policy: ShieldPolicyMode;
    stage: ShieldStage;
    target: string;
    action: ShieldAction;
    blocked: boolean;
    findings: ShieldFinding[];
    summary: string;
}

export interface ShieldInput {
    stage: ShieldStage;
    target: string;
    policy?: ShieldPolicyMode;
    text?: string | string[];
    domains?: string[];
    riskClass?: SkillRiskClass;
    verified?: boolean;
    bindings?: RuntimeBinding[];
    connectors?: ConnectorBinding[];
}

const SECRET_PATTERNS = [
    /api[_-]?key\s*[:=]\s*["']?[a-z0-9_-]{12,}/i,
    /secret\s*[:=]\s*["']?[a-z0-9_-]{8,}/i,
    /ghp_[a-z0-9]{20,}/i,
    /xox[baprs]-[a-z0-9-]{10,}/i,
    /sk-[a-z0-9]{16,}/i,
];

const CLAIM_PATTERNS = [
    /guaranteed/i,
    /100%\s*(roi|secure|accurate|success)/i,
    /always works/i,
    /fully compliant/i,
    /proven growth/i,
];

const DANGEROUS_COMMAND_PATTERNS = [
    /\brm\s+-rf\b/i,
    /\bsudo\b/i,
    /curl\s+[^|]+\|\s*(sh|bash)/i,
    /\bchmod\s+777\b/i,
];

export class SecurityShield {
    evaluate(input: ShieldInput): ShieldDecision {
        const policy = input.policy ?? 'balanced';
        const findings: ShieldFinding[] = [];
        const text = Array.isArray(input.text) ? input.text.join('\n') : (input.text ?? '');
        const domains = new Set((input.domains ?? []).map((domain) => domain.toLowerCase()));

        if (text && SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
            findings.push({
                id: 'secret-leak',
                severity: 'high',
                message: 'Potential secret or credential leak detected.',
                evidence: ['matched secret-like token in artifact content'],
            });
        }

        if (
            text &&
            CLAIM_PATTERNS.some((pattern) => pattern.test(text)) &&
            !input.verified &&
            [...domains].some((domain) => ['gtm', 'marketing', 'sales', 'finance', 'economics', 'writing'].includes(domain))
        ) {
            findings.push({
                id: 'unsupported-claim',
                severity: 'medium',
                message: 'Potential unsupported commercial or editorial claim detected.',
                evidence: ['claim language found without verification evidence'],
            });
        }

        for (const binding of input.bindings ?? []) {
            if (binding.type === 'run_command' && binding.command && DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(binding.command))) {
                findings.push({
                    id: 'dangerous-binding',
                    severity: 'high',
                    message: 'Dangerous command binding detected.',
                    evidence: [binding.command],
                });
            }
        }

        for (const connector of input.connectors ?? []) {
            if (SECRET_PATTERNS.some((pattern) => pattern.test(connector.target))) {
                findings.push({
                    id: 'suspicious-connector',
                    severity: 'high',
                    message: 'Connector target appears to contain a secret or credential.',
                    evidence: [connector.target],
                });
            }
        }

        if (input.stage === 'promotion' && input.riskClass === 'mutate' && !input.verified) {
            findings.push({
                id: 'mutate-promotion-unverified',
                severity: 'medium',
                message: 'Mutating artifact cannot be promoted without verified evidence.',
                evidence: ['promotion requested for mutate artifact without verified=true'],
            });
        }

        const action = resolveAction(policy, findings);
        return {
            decisionId: `shield_${randomUUID().slice(0, 8)}`,
            policy,
            stage: input.stage,
            target: input.target,
            action,
            blocked: action === 'block',
            findings,
            summary: summarizeDecision(input.target, action, findings),
        };
    }
}

function resolveAction(policy: ShieldPolicyMode, findings: ShieldFinding[]): ShieldAction {
    if (findings.some((finding) => finding.severity === 'high')) return 'block';
    if (findings.some((finding) => finding.severity === 'medium')) return policy === 'permissive' ? 'warn' : 'quarantine';
    if (findings.some((finding) => finding.severity === 'low')) return 'warn';
    return 'allow';
}

function summarizeDecision(target: string, action: ShieldAction, findings: ShieldFinding[]): string {
    if (findings.length === 0) {
        return `Security Shield allowed ${target} with no findings.`;
    }

    return `Security Shield set ${action} for ${target} with ${findings.length} finding(s).`;
}

export const createSecurityShield = () => new SecurityShield();
