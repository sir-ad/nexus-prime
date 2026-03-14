import assert from 'assert';
import fs from 'fs';
import path from 'path';

function readDoc(fileName: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'docs', fileName), 'utf8');
}

function expectIncludes(html: string, needle: string, message: string): void {
  assert.ok(html.includes(needle), message);
}

function test() {
  console.log('🧪 Testing docs website wiring...\n');

  const indexHtml = readDoc('index.html');
  const catalogHtml = readDoc('catalog.html');
  const knowledgeBaseHtml = readDoc('knowledge-base.html');
  const integrationsHtml = readDoc('integrations.html');
  const architectureHtml = readDoc('architecture-diagrams.html');
  const readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8');
  const agents = fs.readFileSync(path.join(process.cwd(), 'AGENTS.md'), 'utf8');
  const agentReadme = fs.readFileSync(path.join(process.cwd(), '.agent', 'README.md'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

  expectIncludes(indexHtml, 'href="#documentation"', 'landing page should link to the documentation section');
  expectIncludes(indexHtml, 'href="./knowledge-base.html"', 'landing page should link to the knowledge base');
  expectIncludes(indexHtml, 'href="./catalog.html"', 'landing page should link to the catalog page');
  expectIncludes(indexHtml, 'href="./integrations.html"', 'landing page should link to the integrations page');
  expectIncludes(indexHtml, 'href="./architecture-diagrams.html"', 'landing page should link to the architecture diagrams page');
  expectIncludes(catalogHtml, 'Generated Platform Registry', 'catalog page should describe the generated platform registry');
  expectIncludes(catalogHtml, './assets/feature-registry.json', 'catalog page should load the generated feature registry asset');
  expectIncludes(catalogHtml, 'href="./knowledge-base.html"', 'catalog page should link to the knowledge base');
  expectIncludes(catalogHtml, 'href="./architecture-diagrams.html"', 'catalog page should link to architecture diagrams');
  expectIncludes(knowledgeBaseHtml, 'href="./integrations.html"', 'knowledge base should link to integrations');
  expectIncludes(knowledgeBaseHtml, 'href="./architecture-diagrams.html"', 'knowledge base should link to architecture diagrams');
  expectIncludes(knowledgeBaseHtml, 'Docs Home →', 'knowledge base should link back to docs home');
  expectIncludes(integrationsHtml, 'href="./knowledge-base.html"', 'integrations page should link to knowledge base');
  expectIncludes(integrationsHtml, 'href="./architecture-diagrams.html"', 'integrations page should link to architecture diagrams');
  expectIncludes(architectureHtml, 'href="./knowledge-base.html"', 'architecture page should link to knowledge base');
  expectIncludes(architectureHtml, 'href="./catalog.html"', 'architecture page should link to the catalog page');
  expectIncludes(architectureHtml, 'href="./integrations.html"', 'architecture page should link to integrations');
  expectIncludes(architectureHtml, 'Diagram Index', 'architecture page should render the diagram sidebar');
  expectIncludes(readme, 'https://sir-ad.github.io/nexus-prime/', 'README should point to the public website');
  expectIncludes(readme, 'https://sir-ad.github.io/nexus-prime/knowledge-base.html', 'README should point to the public docs');
  expectIncludes(readme, 'nexus_session_bootstrap', 'README should document the bootstrap-first path');
  expectIncludes(readme, 'Home-scoped bootstrap now runs automatically on install or first binary start', 'README should explain automatic bootstrap');
  expectIncludes(readme, '<!-- feature-registry:start -->', 'README should expose stable feature registry markers');
  expectIncludes(readme, '<!-- runtime-catalog:start -->', 'README should expose stable runtime catalog markers');
  expectIncludes(readme, '🧭 Platform Feature Registry', 'README should include the generated feature registry section');
  expectIncludes(readme, '🗂 Runtime Catalog', 'README should include the runtime catalog section');
  expectIncludes(readme, 'dashboard_runtime_overview.png', 'README should reference the updated overview screenshot');
  expectIncludes(readme, 'dashboard_knowledge_focus.png', 'README should reference the updated knowledge screenshot');
  expectIncludes(agents, 'nexus_orchestrate', 'AGENTS should document the orchestrator-first entrypoint');
  expectIncludes(agents, 'nexus_session_bootstrap', 'AGENTS should document the bootstrap-first entrypoint');
  expectIncludes(agents, 'nexus_list_skills', 'AGENTS should document skill discovery');
  expectIncludes(agents, 'nexus_list_workflows', 'AGENTS should document workflow discovery');
  expectIncludes(agents, 'nexus_list_hooks', 'AGENTS should document hook discovery');
  expectIncludes(agents, 'nexus_list_automations', 'AGENTS should document automation discovery');
  expectIncludes(agents, '.agent/runtime/context.json', 'AGENTS should document worker runtime context handoff');
  expectIncludes(agents, '.agent/runtime/packet.json', 'AGENTS should document the compiled instruction packet handoff');
  expectIncludes(agentReadme, '.agent/rules/*', '.agent README should document the durable rule source');
  expectIncludes(agentReadme, '.agent/runtime/packet.json', '.agent README should document the compiled packet output');
  expectIncludes(agentReadme, '.agent/client-bootstrap', '.agent README should document generated client bootstrap files');
  assert.ok(agents.split('\n').length <= 160, 'AGENTS should remain compact enough for humans');
  assert.ok(!agents.includes('Available MCP Tools (44 total'), 'AGENTS should avoid stale hardcoded tool totals');
  assert.ok(!agents.includes('### Available skills'), 'AGENTS should not embed a full static skill inventory');
  assert.ok(!readme.includes('20 native MCP tools'), 'README should not hardcode stale MCP tool counts');
  assert.ok(!indexHtml.includes('20 MCP Tools'), 'landing page should not hardcode stale MCP tool counts');
  assert.ok(!integrationsHtml.includes('NUXUS_PRIME_MCP'), 'integrations page should not contain the stale setup typo');
  expectIncludes(indexHtml, 'nexus_session_bootstrap', 'landing page should mention the bootstrap-first entrypoint');
  expectIncludes(integrationsHtml, 'nexus-prime setup windsurf', 'integrations page should document Windsurf setup');
  expectIncludes(integrationsHtml, 'nexus-prime setup antigravity', 'integrations page should document Antigravity setup');
  expectIncludes(integrationsHtml, 'nexus-prime setup codex', 'integrations page should document Codex setup');
  expectIncludes(integrationsHtml, 'first Nexus run in a repo writes workspace-scoped files', 'integrations page should explain automatic workspace bootstrap');
  expectIncludes(integrationsHtml, 'AGENTS.md', 'integrations page should document the managed Codex AGENTS file');
  expectIncludes(indexHtml, 'Menu', 'landing page should expose a mobile navigation control');
  expectIncludes(catalogHtml, 'Menu', 'catalog page should expose a mobile navigation control');
  expectIncludes(knowledgeBaseHtml, 'Menu', 'knowledge base should expose a mobile navigation control');
  expectIncludes(integrationsHtml, 'Menu', 'integrations should expose a mobile navigation control');
  expectIncludes(architectureHtml, 'Menu', 'architecture page should expose a mobile navigation control');
  expectIncludes(indexHtml, 'rel="canonical"', 'landing page should declare a canonical URL');
  expectIncludes(catalogHtml, 'rel="canonical"', 'catalog page should declare a canonical URL');
  expectIncludes(indexHtml, 'property="og:image"', 'landing page should declare a social preview image');
  expectIncludes(indexHtml, 'dashboard_runtime_overview.png', 'landing page should reference the updated overview screenshot');
  expectIncludes(indexHtml, 'dashboard_knowledge_focus.png', 'landing page should reference the updated knowledge screenshot');
  expectIncludes(indexHtml, 'nexus-prime setup codex', 'landing page should document Codex setup');
  expectIncludes(indexHtml, 'auto-establish bootstrap artifacts', 'landing page should explain automatic bootstrap behavior');
  expectIncludes(knowledgeBaseHtml, 'rel="canonical"', 'knowledge base should declare a canonical URL');
  expectIncludes(integrationsHtml, 'rel="canonical"', 'integrations should declare a canonical URL');
  expectIncludes(architectureHtml, 'rel="canonical"', 'architecture page should declare a canonical URL');
  assert.strictEqual(packageJson.homepage, 'https://sir-ad.github.io/nexus-prime/', 'package homepage should point to GitHub Pages');

  console.log('✅ Docs website navigation and metadata are wired correctly\n');
}

test();
