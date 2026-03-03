/**
 * Nexus Prime - Skill Card Registry
 *
 * Declarative skill format stored in Graph Knowledge Engine.
 * Supports evaluation and serialization without arbitrary `eval()`.
 *
 * Phase: 8E (Skill Cards)
 */

import { GraphMemoryEngine } from './graph-memory.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SkillTriggerCondition {
    field: 'files_modified' | 'files_accessed' | 'task_keywords' | 'tool_count';
    operator: '>' | '<' | '==' | 'contains';
    value: string | number;
}

export interface SkillTrigger {
    conditions: SkillTriggerCondition[];
    logic: 'AND' | 'OR';
}

export interface SkillAction {
    tool: string;
    args: Record<string, string>;
}

export interface SkillCard {
    name: string;
    trigger: SkillTrigger;
    actions: SkillAction[];
    confidence: number;
    adoptions: number;
    origin: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization (Zero External Dependencies)
// ─────────────────────────────────────────────────────────────────────────────

/** Serialize a SkillCard to a simple YAML representation */
export function serializeSkillCardToYaml(card: SkillCard): string {
    const lines = [
        `name: "${card.name}"`,
        `confidence: ${card.confidence}`,
        `adoptions: ${card.adoptions}`,
        `origin: "${card.origin}"`,
        `trigger:`,
        `  logic: ${card.trigger.logic}`,
        `  conditions:`
    ];

    for (const cond of card.trigger.conditions) {
        lines.push(`    - field: ${cond.field}`);
        lines.push(`      operator: ${cond.operator}`);
        const valStr = typeof cond.value === 'string' ? `"${cond.value}"` : cond.value;
        lines.push(`      value: ${valStr}`);
    }

    lines.push(`actions:`);
    for (const action of card.actions) {
        lines.push(`  - tool: ${action.tool}`);
        lines.push(`    args:`);
        for (const [k, v] of Object.entries(action.args)) {
            lines.push(`      ${k}: "${v}"`);
        }
    }

    return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

export class SkillCardRegistry {
    constructor(private graphEngine: GraphMemoryEngine) { }

    /**
     * Register a new SkillCard into the Graph Knowledge Engine
     */
    register(card: SkillCard): string {
        // Serialize to YAML
        const yamlContent = serializeSkillCardToYaml(card);

        // Store as entity of type "skill"
        const entity = this.graphEngine.upsertEntity(card.name, 'skill', {
            confidence: card.confidence,
            adoptions: card.adoptions,
            origin: card.origin
        });

        // Store the YAML content as a fact version
        this.graphEngine.addFact(entity.id, yamlContent);

        // Optionally, create relations to the tools it uses
        for (const action of card.actions) {
            const toolEntity = this.graphEngine.upsertEntity(action.tool, 'mcp_tool');
            this.graphEngine.addRelation(entity.id, toolEntity.id, 'utilizes', 1.0);
        }

        return entity.id;
    }

    /**
     * Retrieve a SkillCard's YAML from the Graph Engine
     */
    getSkillYaml(name: string): string | null {
        // Find entities matching name
        const entities = this.graphEngine.findEntities(name, 1);
        const entity = entities.find(e => e.type === 'skill');
        if (!entity) return null;

        const fact = this.graphEngine.getCurrentFact(entity.id);
        return fact ? fact.content : null;
    }
}
