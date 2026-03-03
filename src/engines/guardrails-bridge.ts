/**
 * Guardrails Bridge — Mindkit guardrails within nexus-prime src/
 *
 * Provides GuardrailEngine directly within the src/ tree so mcp.ts
 * can import it without going outside rootDir. This mirrors the same
 * 6 rules from packages/mindkit/src/guardrails.ts.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

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
    private externalRules: Rule[] = [];
    private static CACHE_PATH = path.join(os.homedir(), '.nexus-prime', 'mindkit-cache.json');

    check(ctx: GuardrailContext): GuardrailResult {
        const allRules = [...RULES, ...this.externalRules];
        const violations: GuardrailViolation[] = [];
        const warnings: GuardrailViolation[] = [];

        for (const rule of allRules) {
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
        return [...RULES, ...this.externalRules].map(r => ({ id: r.id, rule: r.rule, severity: r.severity }));
    }

    /**
     * Sync guardrail rules from the MindKit GitHub repo.
     * Fetches from sir-ad/mindkit, caches locally for 1 hour.
     * Falls back silently to bundled rules if offline.
     */
    async syncFromGitHub(): Promise<{ synced: boolean; ruleCount: number; source: string }> {
        // Check cache first (1-hour TTL)
        try {
            if (fs.existsSync(GuardrailEngine.CACHE_PATH)) {
                const cached = JSON.parse(fs.readFileSync(GuardrailEngine.CACHE_PATH, 'utf-8'));
                const age = Date.now() - (cached.timestamp ?? 0);
                if (age < 3600_000 && Array.isArray(cached.rules)) {
                    this.loadExternalRules(cached.rules);
                    return { synced: true, ruleCount: this.externalRules.length, source: 'cache' };
                }
            }
        } catch { /* cache miss */ }

        // Fetch from GitHub
        try {
            const url = 'https://raw.githubusercontent.com/sir-ad/mindkit/main/src/guardrails.ts';
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const content = await response.text();

            // Extract rule IDs and descriptions from the fetched source
            const ruleMatches = [...content.matchAll(/id:\s*['"]([^'"]+)['"]\s*,\s*rule:\s*['"]([^'"]+)['"]/g)];
            const fetchedRules = ruleMatches.map(m => ({ id: m[1], rule: m[2] }));

            // Cache the fetched data
            const cacheDir = path.dirname(GuardrailEngine.CACHE_PATH);
            if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
            fs.writeFileSync(GuardrailEngine.CACHE_PATH, JSON.stringify({
                timestamp: Date.now(),
                rules: fetchedRules,
                sourceUrl: url
            }));

            this.loadExternalRules(fetchedRules);
            return { synced: true, ruleCount: this.externalRules.length, source: 'github' };
        } catch {
            // Offline — use bundled rules only
            return { synced: false, ruleCount: RULES.length, source: 'bundled' };
        }
    }

    private loadExternalRules(fetched: Array<{ id: string; rule: string }>): void {
        // Only add rules that don't already exist in the built-in set
        const builtinIds = new Set(RULES.map(r => r.id));
        const newRules: Rule[] = fetched
            .filter(r => !builtinIds.has(r.id))
            .map(r => ({
                id: r.id,
                rule: r.rule,
                severity: 'info' as GuardrailSeverity,
                check: () => null  // External rules are informational — no active enforcement yet
            }));
        this.externalRules = newRules;
    }

    /**
     * Bidirectional MindKit sync — push Nexus findings back to MindKit.
     * Writes evolution candidates, session learnings, and guardrail outcomes
     * to MindKit's memory/sessions directory via GitHub API.
     */
    async pushFindingsToMindKit(findings: {
        sessionId: string;
        findings: string[];
        hotspots: Array<[string, number]>;
        recommendations: string[];
    }): Promise<{ pushed: boolean; reason: string }> {
        const token = process.env.GITHUB_TOKEN;
        if (!token) return { pushed: false, reason: 'No GITHUB_TOKEN — skipping MindKit push' };

        try {
            const sessionDate = new Date().toISOString().split('T')[0];
            const content = [
                `# Nexus Prime Session: ${findings.sessionId}`,
                `Date: ${sessionDate}`,
                '',
                '## Findings',
                ...findings.findings.map(f => `- ${f}`),
                '',
                '## Hotspots',
                ...findings.hotspots.map(([file, count]) => `- ${count}x ${file}`),
                '',
                '## Recommendations',
                ...findings.recommendations.map(r => `- ${r}`),
            ].join('\n');

            const encoded = Buffer.from(content).toString('base64');
            const filePath = `memory/sessions/nexus-${sessionDate}-${findings.sessionId.slice(0, 8)}.md`;

            const res = await fetch(`https://api.github.com/repos/sir-ad/mindkit/contents/${filePath}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github+json',
                },
                body: JSON.stringify({
                    message: `nexus-prime: session findings ${sessionDate}`,
                    content: encoded,
                }),
            });

            if (res.ok) {
                return { pushed: true, reason: `Pushed to mindkit/${filePath}` };
            } else {
                const errText = await res.text();
                return { pushed: false, reason: `GitHub API ${res.status}: ${errText.slice(0, 100)}` };
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            return { pushed: false, reason: `Push failed: ${msg}` };
        }
    }
}

