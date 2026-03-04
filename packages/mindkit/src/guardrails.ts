/**
 * Mindkit Guardrails — Machine-Checkable Agent Rules
 *
 * Converts the natural-language GUARDRAILS.md into enforceable runtime checks.
 * Each guardrail has: id, description, check function, severity.
 *
 * Use: guardrails.check(action, context) → { passed, violations }
 */

export type GuardrailSeverity = 'error' | 'warn' | 'info';

export interface GuardrailContext {
    /** Text of the action/prompt being checked */
    action: string;
    /** Estimated token count of current context */
    tokenCount?: number;
    /** Files that will be modified */
    filesToModify?: string[];
    /** Whether the operation is destructive (delete, overwrite) */
    isDestructive?: boolean;
    /** Current output format */
    outputFormat?: 'json' | 'text' | 'markdown' | 'code';
    /** Working directory */
    cwd?: string;
}

export interface GuardrailViolation {
    id: string;
    severity: GuardrailSeverity;
    rule: string;
    detail: string;
    suggestion: string;
}

export interface GuardrailCheck {
    passed: boolean;
    violations: GuardrailViolation[];
    warnings: GuardrailViolation[];
    score: number; // 0-1, 1 = fully compliant
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardrail Definitions
// ─────────────────────────────────────────────────────────────────────────────

interface Guardrail {
    id: string;
    rule: string;
    severity: GuardrailSeverity;
    check: (ctx: GuardrailContext) => GuardrailViolation | null;
}

const GUARDRAILS: Guardrail[] = [
    {
        id: 'TOKEN_BUDGET',
        rule: 'Token budget must stay under 80k for a single context window',
        severity: 'error',
        check: (ctx) => {
            const limit = 80_000;
            if (ctx.tokenCount && ctx.tokenCount > limit) {
                return {
                    id: 'TOKEN_BUDGET',
                    severity: 'error',
                    rule: 'Token budget exceeded',
                    detail: `Context is ${ctx.tokenCount.toLocaleString()} tokens (limit: ${limit.toLocaleString()})`,
                    suggestion: 'Use nexus_optimize_tokens to reduce scope before proceeding'
                };
            }
            return null;
        }
    },
    {
        id: 'TOKEN_WARN',
        rule: 'Warn when token usage exceeds 50k',
        severity: 'warn',
        check: (ctx) => {
            const warn = 50_000;
            if (ctx.tokenCount && ctx.tokenCount > warn) {
                return {
                    id: 'TOKEN_WARN',
                    severity: 'warn',
                    rule: 'High token usage',
                    detail: `Context is ${ctx.tokenCount.toLocaleString()} tokens (warn: ${warn.toLocaleString()})`,
                    suggestion: 'Consider pruning context or using outline-only reads for large files'
                };
            }
            return null;
        }
    },
    {
        id: 'DESTRUCTIVE_GUARD',
        rule: 'Destructive operations require explicit --force flag or user confirmation',
        severity: 'error',
        check: (ctx) => {
            const destructivePatterns = [
                /\bdelete\b/i, /\brm\s+-rf\b/, /\bdrop\s+table\b/i,
                /\btruncate\b/i, /\bformat\b/i, /\bwipe\b/i
            ];
            if (ctx.isDestructive) {
                return {
                    id: 'DESTRUCTIVE_GUARD',
                    severity: 'error',
                    rule: 'Destructive operation without confirmation',
                    detail: 'Operation is flagged as destructive',
                    suggestion: 'Add --force flag or request explicit user confirmation before proceeding'
                };
            }
            const hasDestructive = destructivePatterns.some(p => p.test(ctx.action));
            if (hasDestructive && ctx.isDestructive !== false) {
                return {
                    id: 'DESTRUCTIVE_GUARD',
                    severity: 'warn',
                    rule: 'Potentially destructive action detected',
                    detail: `Action contains destructive keyword: "${ctx.action.slice(0, 100)}"`,
                    suggestion: 'Verify this is intentional. Set isDestructive=false to suppress if safe.'
                };
            }
            return null;
        }
    },
    {
        id: 'BULK_FILE_GUARD',
        rule: 'Reading/modifying more than 10 files at once requires token optimization first',
        severity: 'warn',
        check: (ctx) => {
            if (ctx.filesToModify && ctx.filesToModify.length > 10) {
                return {
                    id: 'BULK_FILE_GUARD',
                    severity: 'warn',
                    rule: 'Bulk file operation without optimization',
                    detail: `${ctx.filesToModify.length} files in scope`,
                    suggestion: 'Run nexus_optimize_tokens or nexus_ghost_pass first to reduce scope'
                };
            }
            return null;
        }
    },
    {
        id: 'NO_PROD_WRITES',
        rule: 'Do not write to /etc, /usr, /bin, /sbin, /System without explicit confirmation',
        severity: 'error',
        check: (ctx) => {
            const protectedPaths = ['/etc/', '/usr/', '/bin/', '/sbin/', '/System/'];
            const files = ctx.filesToModify ?? [];
            const dangerous = files.filter(f => protectedPaths.some(p => f.startsWith(p)));
            if (dangerous.length > 0) {
                return {
                    id: 'NO_PROD_WRITES',
                    severity: 'error',
                    rule: 'Write to protected system path',
                    detail: `Files in protected paths: ${dangerous.join(', ')}`,
                    suggestion: 'This action is blocked. Require explicit user override.'
                };
            }
            return null;
        }
    },
    {
        id: 'MEMORY_FIRST',
        rule: 'Check memory before researching something you may already know',
        severity: 'info',
        check: (ctx) => {
            const researchKeywords = ['research', 'look up', 'search for', 'find out', 'investigate'];
            const isResearch = researchKeywords.some(kw => ctx.action.toLowerCase().includes(kw));
            if (isResearch) {
                return {
                    id: 'MEMORY_FIRST',
                    severity: 'info',
                    rule: 'Research action without memory check',
                    detail: 'You may already have context about this in memory',
                    suggestion: 'Call nexus_recall_memory first before doing external research'
                };
            }
            return null;
        }
    },
    {
        id: 'GIST_PUBLISH_GUARD',
        rule: 'Do not publish passwords, secrets, or payloads > 100k chars to Gist',
        severity: 'error',
        check: (ctx) => {
            const isPublish = /\b(nexusnet_transmit|publish)\b/i.test(ctx.action);
            if (!isPublish) return null;

            if (ctx.action.length > 100_000) {
                return {
                    id: 'GIST_PUBLISH_GUARD',
                    severity: 'error',
                    rule: 'Payload exceeds 100k characters',
                    detail: `Payload is ${ctx.action.length.toLocaleString()} characters`,
                    suggestion: 'Summarize or truncate the payload before publishing.'
                };
            }

            const secretsRegex = /(ghp_|sk-ant-|password|secret|\.env\b)/i;
            if (secretsRegex.test(ctx.action)) {
                return {
                    id: 'GIST_PUBLISH_GUARD',
                    severity: 'error',
                    rule: 'Secret detected in publish payload',
                    detail: 'Payload contains potential secrets (API keys, passwords, .env refs)',
                    suggestion: 'Remove ALL secrets before publishing to public NexusNet Gist.'
                };
            }

            return null;
        }
    },
    {
        id: 'MEMORY_SIZE_GUARD',
        rule: 'Do not store raw file dumps > 10k chars in memory',
        severity: 'error',
        check: (ctx) => {
            const isStore = /\bnexus_store_memory\b/i.test(ctx.action);
            if (!isStore) return null;

            if (ctx.action.length > 10_000) {
                return {
                    id: 'MEMORY_SIZE_GUARD',
                    severity: 'error',
                    rule: 'Memory > 10k chars',
                    detail: `Memory payload is ${ctx.action.length.toLocaleString()} characters`,
                    suggestion: 'Synthesize and summarize insights before storing them in memory.'
                };
            }
            return null;
        }
    }
];

// ─────────────────────────────────────────────────────────────────────────────
// GuardrailEngine
// ─────────────────────────────────────────────────────────────────────────────

export class GuardrailEngine {
    private rules: Guardrail[];

    constructor(customRules?: Guardrail[]) {
        this.rules = [...GUARDRAILS, ...(customRules ?? [])];
    }

    /** Check an action against all guardrails */
    check(ctx: GuardrailContext): GuardrailCheck {
        const violations: GuardrailViolation[] = [];
        const warnings: GuardrailViolation[] = [];

        for (const guardrail of this.rules) {
            const result = guardrail.check(ctx);
            if (result) {
                if (result.severity === 'error') {
                    violations.push(result);
                } else if (result.severity === 'warn') {
                    warnings.push(result);
                } else {
                    warnings.push(result); // info goes to warnings (non-blocking)
                }
            }
        }

        const score = violations.length === 0
            ? Math.max(0, 1 - (warnings.length * 0.1))
            : 0;

        return {
            passed: violations.length === 0,
            violations,
            warnings,
            score
        };
    }

    /** Format a check result as human-readable text */
    format(result: GuardrailCheck): string {
        const lines: string[] = [];

        if (result.passed) {
            lines.push(`✅ Guardrail check PASSED (score: ${(result.score * 100).toFixed(0)}%)`);
        } else {
            lines.push(`❌ Guardrail check FAILED — ${result.violations.length} violation(s)`);
        }

        for (const v of result.violations) {
            lines.push(`\n  🚫 [${v.id}] ${v.rule}`);
            lines.push(`     ${v.detail}`);
            lines.push(`     → ${v.suggestion}`);
        }

        for (const w of result.warnings) {
            const icon = w.severity === 'info' ? 'ℹ️' : '⚠️';
            lines.push(`\n  ${icon} [${w.id}] ${w.rule}`);
            lines.push(`     ${w.detail}`);
            lines.push(`     → ${w.suggestion}`);
        }

        return lines.join('\n');
    }

    /** List all defined rules */
    listRules(): Array<{ id: string; rule: string; severity: GuardrailSeverity }> {
        return this.rules.map(r => ({ id: r.id, rule: r.rule, severity: r.severity }));
    }
}

export const createGuardrailEngine = (customRules?: Guardrail[]) =>
    new GuardrailEngine(customRules);
