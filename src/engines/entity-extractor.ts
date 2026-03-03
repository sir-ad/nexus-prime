/**
 * Entity Extractor
 *
 * Extracts entities and relations from unstructured text using
 * keyword/regex patterns. No external LLM dependency — pure local.
 *
 * Phase: 8D (Graph Knowledge Engine)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type EntityType = 'file' | 'function' | 'bug' | 'decision' | 'concept' | 'session' | 'agent';
export type RelationType = 'contains' | 'caused_by' | 'fixed_in' | 'depends_on' | 'related_to' | 'supersedes';

export interface ExtractedEntity {
    name: string;
    type: EntityType;
    confidence: number;   // 0.0-1.0
}

export interface ExtractedRelation {
    from: string;         // entity name
    to: string;           // entity name
    type: RelationType;
    confidence: number;
}

export interface ExtractionResult {
    entities: ExtractedEntity[];
    relations: ExtractedRelation[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Patterns
// ─────────────────────────────────────────────────────────────────────────────

const ENTITY_PATTERNS: Array<{ pattern: RegExp; type: EntityType; confidence: number }> = [
    // File paths: src/foo/bar.ts, ./config.json, path/to/file.ext
    { pattern: /(?:^|\s)((?:src|lib|dist|test|__tests__)\/[\w/.-]+\.\w+)/gi, type: 'file', confidence: 0.95 },
    { pattern: /(?:^|\s)([\w.-]+\.(?:ts|js|tsx|jsx|json|sql|md|yml|yaml))\b/gi, type: 'file', confidence: 0.85 },

    // Functions: functionName(), Class.method(), camelCase identifiers
    { pattern: /\b(\w+(?:\.\w+)?)\(\)/gi, type: 'function', confidence: 0.90 },
    { pattern: /(?:function|method|fn)\s+`?(\w+)`?/gi, type: 'function', confidence: 0.85 },

    // Bugs: "bug in X", "fixed X bug", "error in X"
    { pattern: /(?:bug|error|issue|crash|failure)\s+(?:in\s+)?`?(\w[\w.-]*)`?/gi, type: 'bug', confidence: 0.80 },
    { pattern: /`?(\w[\w.-]*)`?\s+(?:bug|error|issue|crash)/gi, type: 'bug', confidence: 0.75 },

    // Decisions: "decided to X", "chose X", "architecture decision"
    { pattern: /(?:decided|chose|selected|picked)\s+(?:to\s+)?(.{5,40}?)(?:\.|,|$)/gi, type: 'decision', confidence: 0.70 },

    // Sessions: session IDs
    { pattern: /session[- ]?([a-f0-9-]{8,36})/gi, type: 'session', confidence: 0.95 },
];

const RELATION_PATTERNS: Array<{ pattern: RegExp; type: RelationType; confidence: number }> = [
    // Contains: "X contains Y", "Y is in X"
    { pattern: /`?(\w[\w.-]*)`?\s+contains?\s+`?(\w[\w.-]*)`?/gi, type: 'contains', confidence: 0.80 },

    // Caused by: "X caused by Y", "Y causes X"
    { pattern: /`?(\w[\w.-]*)`?\s+caused\s+by\s+`?(\w[\w.-]*)`?/gi, type: 'caused_by', confidence: 0.85 },

    // Fixed in: "fixed in X", "X resolved in Y"
    { pattern: /(?:fixed|resolved|patched)\s+(?:in\s+)?`?(\w[\w.-]*)`?/gi, type: 'fixed_in', confidence: 0.85 },

    // Depends on: "X depends on Y", "X requires Y"
    { pattern: /`?(\w[\w.-]*)`?\s+(?:depends?\s+on|requires?|needs?)\s+`?(\w[\w.-]*)`?/gi, type: 'depends_on', confidence: 0.80 },

    // Related: "X related to Y", "X and Y"
    { pattern: /`?(\w[\w.-]*)`?\s+(?:related\s+to|associated\s+with)\s+`?(\w[\w.-]*)`?/gi, type: 'related_to', confidence: 0.70 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Entity Extractor
// ─────────────────────────────────────────────────────────────────────────────

export class EntityExtractor {

    /**
     * Extract entities and relations from text content.
     * Uses keyword/regex patterns — no external LLM needed.
     */
    extract(text: string): ExtractionResult {
        const entities = this.extractEntities(text);
        const relations = this.extractRelations(text, entities);
        return { entities, relations };
    }

    /** Extract entities from text using regex patterns */
    private extractEntities(text: string): ExtractedEntity[] {
        const seen = new Map<string, ExtractedEntity>();

        for (const { pattern, type, confidence } of ENTITY_PATTERNS) {
            // Reset regex state
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;

            while ((match = pattern.exec(text)) !== null) {
                const name = (match[1] ?? '').trim();
                if (!name || name.length < 2 || name.length > 100) continue;
                if (STOPWORDS.has(name.toLowerCase())) continue;

                const existing = seen.get(name);
                if (!existing || existing.confidence < confidence) {
                    seen.set(name, { name, type, confidence });
                }
            }
        }

        return [...seen.values()];
    }

    /** Extract relations between known entities */
    private extractRelations(text: string, entities: ExtractedEntity[]): ExtractedRelation[] {
        const entityNames = new Set(entities.map(e => e.name.toLowerCase()));
        const relations: ExtractedRelation[] = [];
        const seen = new Set<string>();

        for (const { pattern, type, confidence } of RELATION_PATTERNS) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;

            while ((match = pattern.exec(text)) !== null) {
                const from = (match[1] ?? '').trim();
                const to = (match[2] ?? match[1] ?? '').trim();
                if (!from || !to || from === to) continue;

                const key = `${from}|${to}|${type}`;
                if (seen.has(key)) continue;
                seen.add(key);

                // Only add if at least one entity is known
                if (entityNames.has(from.toLowerCase()) || entityNames.has(to.toLowerCase())) {
                    relations.push({ from, to, type, confidence });
                }
            }
        }

        return relations;
    }

    /**
     * Extract entity names from tags (high confidence).
     * Tags like #bug, #architecture become concept entities.
     */
    extractFromTags(tags: string[]): ExtractedEntity[] {
        return tags
            .filter(t => t.length > 1)
            .map(tag => ({
                name: tag.replace(/^#/, ''),
                type: 'concept' as EntityType,
                confidence: 0.95,
            }));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stopwords — filter these from entity extraction
// ─────────────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
    'the', 'and', 'for', 'this', 'that', 'with', 'from', 'are', 'was', 'not',
    'but', 'have', 'has', 'had', 'will', 'can', 'all', 'been', 'its', 'may',
    'use', 'new', 'each', 'which', 'their', 'any', 'also', 'when', 'how',
    'true', 'false', 'null', 'undefined', 'void', 'string', 'number', 'boolean',
]);
