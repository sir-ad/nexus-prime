/**
 * Guardrails Bridge — Mindkit guardrails within nexus-prime src/
 *
 * Provides GuardrailEngine directly within the src/ tree so mcp.ts
 * can import it without going outside rootDir. This mirrors the same
 * 6 rules from packages/mindkit/src/guardrails.ts.
 */

export type GuardrailSeverity = 'error' | 'warn' | 'info';

export interface GuardrailContext {
    action: string;
    tokenCount?: number;
    filesToModify?: string[];
    isDestructive?: boolean;
}

export interface GuardrailViolation {
    id: string;
    severity: GuardrailSeverity;
    rule: string;
    detail: string;
    suggestion: string;
}

export interface GuardrailResult {
    passed: boolean;
    violations: GuardrailViolation[];
    warnings: GuardrailViolation[];
    score: number;
}

interface Rule {
    id: string;
    rule: string;
    severity: GuardrailSeverity;
    check: (ctx: GuardrailContext) => GuardrailViolation | null;
}

const RULES: Rule[] = [
    {
        id: 'TOKEN_BUDGET', rule: 'Token budget under 100k', severity: 'error',
        check: (ctx) => ctx.tokenCount && ctx.tokenCount > 100_000
            ? { id: 'TOKEN_BUDGET', severity: 'error', rule: 'Token budget exceeded', detail: `${ctx.tokenCount.toLocaleString()} tokens (limit: 100k)`, suggestion: 'Use nexus_optimize_tokens to reduce scope' }
            : null
    },
    {
        id: 'TOKEN_WARN', rule: 'Warn above 70k tokens', severity: 'warn',
        check: (ctx) => ctx.tokenCount && ctx.tokenCount > 70_000
            ? { id: 'TOKEN_WARN', severity: 'warn', rule: 'High token usage', detail: `${ctx.tokenCount.toLocaleString()} tokens`, suggestion: 'Consider outline-only reads for large files' }
            : null
    },
    {
        id: 'DESTRUCTIVE_GUARD', rule: 'Destructive operations need confirmation', severity: 'error',
        check: (ctx) => ctx.isDestructive === true
            ? { id: 'DESTRUCTIVE_GUARD', severity: 'error', rule: 'Destructive operation', detail: 'isDestructive=true — requires explicit user approval', suggestion: 'Set isDestructive=false if safe, or request user confirmation' }
            : null
    },
    {
        id: 'BULK_FILE_GUARD', rule: 'Cap bulk file modifications at 10+', severity: 'warn',
        check: (ctx) => ctx.filesToModify && ctx.filesToModify.length > 10
            ? { id: 'BULK_FILE_GUARD', severity: 'warn', rule: 'Bulk file operation', detail: `${ctx.filesToModify.length} files in scope`, suggestion: 'Run nexus_optimize_tokens first' }
            : null
    },
    {
        id: 'NO_PROD_WRITES', rule: 'Block writes to system paths', severity: 'error',
        check: (ctx) => {
            const blocked = ['/etc/', '/usr/', '/bin/', '/sbin/', '/System/'];
            const dangerous = (ctx.filesToModify ?? []).filter(f => blocked.some(p => f.startsWith(p)));
            return dangerous.length > 0
                ? { id: 'NO_PROD_WRITES', severity: 'error', rule: 'Protected system path', detail: `Blocked: ${dangerous.join(', ')}`, suggestion: 'These paths cannot be modified without explicit override' }
                : null;
        }
    },
    {
        id: 'MEMORY_FIRST', rule: 'Check memory before researching', severity: 'info',
        check: (ctx) => {
            const kw = ['research', 'look up', 'search for', 'find out', 'investigate'];
            return kw.some(k => ctx.action.toLowerCase().includes(k))
                ? { id: 'MEMORY_FIRST', severity: 'info', rule: 'Research without memory check', detail: 'You may already know this', suggestion: 'Call nexus_recall_memory first' }
                : null;
        }
    },
    {
        id: 'NO_SECRETS', rule: 'Block output containing secrets', severity: 'error',
        check: (ctx) => {
            const secretPatterns = [
                /xox[bp]-[0-9]{12}-[0-9]{12}-[0-9]{12}-[a-z0-9]{32}/i,
                /AIza[0-9A-Za-z-_]{35}/,
                /sk-[a-zA-Z0-9]{48}/,
                /sq0csp-[0-9A-Za-z-_]{43}/,
                /access_key_id|secret_access_key|api_key|password|client_secret/i
            ];
            const found = secretPatterns.some(p => p.test(ctx.action));
            return found
                ? { id: 'NO_SECRETS', severity: 'error', rule: 'Potential secret detected', detail: 'Action contains patterns matching API keys or passwords', suggestion: 'Remove secrets before proceeding' }
                : null;
        }
    },
    {
        id: 'NO_INSTALLS', rule: 'Block unauthorized installs', severity: 'error',
        check: (ctx) => {
            const installCmds = ['npm install', 'npm i ', 'yarn add', 'pip install', 'cargo add'];
            const found = installCmds.some(c => ctx.action.toLowerCase().includes(c));
            return found
                ? { id: 'NO_INSTALLS', severity: 'error', rule: 'Unauthorized installation', detail: 'Installation commands require explicit user approval', suggestion: 'Set isDestructive=true or ask user' }
                : null;
        }
    },
    {
        id: 'OUTLINE_FIRST', rule: 'Encourage outline before full read', severity: 'info',
        check: (ctx) => {
            const action = ctx.action.toLowerCase();
            if (action.includes('read') && !action.includes('outline') && !action.includes('partial')) {
                return { id: 'OUTLINE_FIRST', severity: 'info', rule: 'Read without outline', detail: 'Reading full files is token-expensive', suggestion: 'Use view_file_outline first' };
            }
            return null;
        }
    },
    {
        id: 'QUALITY_GATES', rule: 'Verify changes with test/build', severity: 'warn',
        check: (ctx) => {
            const action = ctx.action.toLowerCase();
            const hasMod = ctx.filesToModify && ctx.filesToModify.length > 0;
            const hasVerify = action.includes('test') || action.includes('build') || action.includes('verify');
            if (hasMod && !hasVerify) {
                return { id: 'QUALITY_GATES', severity: 'warn', rule: 'Changes without verification', detail: 'Modifying files without a plan to test or build', suggestion: 'Include npm test or npm run build in your plan' };
            }
            return null;
        }
    }
];

export class GuardrailEngine {
    check(ctx: GuardrailContext): GuardrailResult {
        const violations: GuardrailViolation[] = [];
        const warnings: GuardrailViolation[] = [];

        for (const rule of RULES) {
            const r = rule.check(ctx);
            if (!r) continue;
            if (r.severity === 'error') violations.push(r);
            else warnings.push(r);
        }

        return {
            passed: violations.length === 0,
            violations,
            warnings,
            score: violations.length === 0 ? Math.max(0, 1 - warnings.length * 0.1) : 0
        };
    }

    format(result: GuardrailResult): string {
        const lines: string[] = [];
        lines.push(result.passed
            ? `✅ PASSED (score: ${Math.round(result.score * 100)}%)`
            : `❌ FAILED — ${result.violations.length} violation(s)`);
        for (const v of result.violations)
            lines.push(`\n  🚫 [${v.id}] ${v.rule}\n     ${v.detail}\n     → ${v.suggestion}`);
        for (const w of result.warnings)
            lines.push(`\n  ${w.severity === 'info' ? 'ℹ️' : '⚠️'} [${w.id}] ${w.rule}\n     ${w.detail}\n     → ${w.suggestion}`);
        return lines.join('\n');
    }

    listRules() {
        return RULES.map(r => ({ id: r.id, rule: r.rule, severity: r.severity }));
    }
}
