import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkillRuntime } from '../src/engines/skill-runtime.ts';
import { WorkflowRuntime } from '../src/engines/workflow-runtime.ts';
import { HookRuntime } from '../src/engines/hook-runtime.ts';
import { AutomationRuntime } from '../src/engines/automation-runtime.ts';
import { listCrewTemplates } from '../src/engines/specialist-roster.ts';
import { buildFeatureRegistry, renderFeatureRegistryMarkdown } from '../src/engines/feature-registry.ts';

const README_PATH = path.join(process.cwd(), 'README.md');
const FEATURE_JSON_PATH = path.join(process.cwd(), 'docs', 'assets', 'feature-registry.json');
const FEATURE_START_MARKER = '<!-- feature-registry:start -->';
const FEATURE_END_MARKER = '<!-- feature-registry:end -->';
const START_MARKER = '<!-- runtime-catalog:start -->';
const END_MARKER = '<!-- runtime-catalog:end -->';

function compact(value: string, max = 140): string {
  const singleLine = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
  if (!singleLine) return 'n/a';
  return singleLine.length > max ? `${singleLine.slice(0, max - 1).trim()}…` : singleLine;
}

function firstInstructionLine(value: string): string {
  const line = String(value || '').split('\n').find((entry) => entry.trim()) || '';
  return compact(line.replace(/^#+\s*/, ''));
}

function renderTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows
    .map((row) => `| ${row.map((cell) => compact(cell)).join(' | ')} |`)
    .join('\n');
  return [head, divider, body].join('\n');
}

function renderSection(title: string, count: number, table: string): string {
  return [
    `<details>`,
    `<summary><b>${title}</b> (${count})</summary>`,
    '',
    table,
    '',
    `</details>`,
  ].join('\n');
}

function generateCatalogBlock(): string {
  const workspaceRoot = process.cwd();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-prime-readme-catalog-'));

  const skillRuntime = new SkillRuntime(undefined, path.join(tempRoot, 'skills'), workspaceRoot);
  const workflowRuntime = new WorkflowRuntime(path.join(tempRoot, 'workflows'), workspaceRoot);
  const hookRuntime = new HookRuntime(path.join(tempRoot, 'hooks'), workspaceRoot);
  const automationRuntime = new AutomationRuntime(path.join(tempRoot, 'automations'), workspaceRoot);
  const crews = listCrewTemplates().slice().sort((left, right) => left.name.localeCompare(right.name));

  const headers = ['Name', 'Type/Scope', 'Purpose', 'Trigger / When used'];

  const skillsTable = renderTable(headers, skillRuntime.listArtifacts().map((artifact) => ([
    artifact.name,
    `${artifact.riskClass} · ${artifact.scope}`,
    firstInstructionLine(artifact.instructions),
    artifact.domain
      ? `${artifact.domain} work or explicit selection`
      : 'runtime selection or explicit skill selection',
  ])));

  const workflowsTable = renderTable(headers, workflowRuntime.listArtifacts().map((artifact) => ([
    artifact.name,
    `workflow · ${artifact.scope}`,
    artifact.description,
    (artifact.triggerConditions || []).length
      ? artifact.triggerConditions.slice(0, 2).join('; ')
      : `${artifact.domain} execution or approval path`,
  ])));

  const hooksTable = renderTable(headers, hookRuntime.listArtifacts().map((artifact) => ([
    artifact.name,
    `${artifact.riskClass} · ${artifact.scope}`,
    artifact.description,
    [artifact.trigger, ...(artifact.conditions || []).slice(0, 1)].join(' · '),
  ])));

  const automationsTable = renderTable(headers, automationRuntime.listArtifacts().map((artifact) => ([
    artifact.name,
    `${artifact.triggerMode} · ${artifact.scope}`,
    artifact.description,
    artifact.eventTrigger
      ? `event:${artifact.eventTrigger}`
      : artifact.schedule || artifact.connectorEvent || 'runtime dispatch',
  ])));

  const crewsTable = renderTable(headers, crews.map((crew) => ([
    crew.name,
    'crew template',
    crew.summary,
    `domains: ${(crew.domains || []).join(', ')}${crew.reviewGates.length ? ` · gates: ${crew.reviewGates.join(', ')}` : ''}`,
  ])));

  return [
    START_MARKER,
    '<details>',
    '<summary><b>🗂 Runtime Catalog</b></summary>',
    '',
    'Generated from bundled runtime catalogs plus repo-local overrides via `npm run generate:readme-catalog`.',
    '',
    renderSection('Skills', skillRuntime.listArtifacts().length, skillsTable),
    '',
    renderSection('Workflows', workflowRuntime.listArtifacts().length, workflowsTable),
    '',
    renderSection('Hooks', hookRuntime.listArtifacts().length, hooksTable),
    '',
    renderSection('Automations', automationRuntime.listArtifacts().length, automationsTable),
    '',
    renderSection('Crews', crews.length, crewsTable),
    '',
    '</details>',
    END_MARKER,
  ].join('\n');
}

function replaceCatalogBlock(readme: string, block: string): string {
  const start = readme.indexOf(START_MARKER);
  const end = readme.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('README runtime catalog markers are missing or malformed.');
  }
  return `${readme.slice(0, start)}${block}${readme.slice(end + END_MARKER.length)}`;
}

function replaceFeatureBlock(readme: string, block: string): string {
  const start = readme.indexOf(FEATURE_START_MARKER);
  const end = readme.indexOf(FEATURE_END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('README feature registry markers are missing or malformed.');
  }
  return `${readme.slice(0, start)}${FEATURE_START_MARKER}\n${block}\n${FEATURE_END_MARKER}${readme.slice(end + FEATURE_END_MARKER.length)}`;
}

function main(): void {
  const featureRegistry = buildFeatureRegistry(process.cwd());
  const block = generateCatalogBlock();
  if (process.argv.includes('--stdout')) {
    process.stdout.write(`${renderFeatureRegistryMarkdown(featureRegistry)}\n\n${block}\n`);
    return;
  }

  const readme = fs.readFileSync(README_PATH, 'utf8');
  const withFeatures = replaceFeatureBlock(readme, renderFeatureRegistryMarkdown(featureRegistry));
  const next = replaceCatalogBlock(withFeatures, block);
  fs.writeFileSync(README_PATH, next, 'utf8');
  fs.mkdirSync(path.dirname(FEATURE_JSON_PATH), { recursive: true });
  fs.writeFileSync(FEATURE_JSON_PATH, `${JSON.stringify(featureRegistry, null, 2)}\n`, 'utf8');
}

main();
