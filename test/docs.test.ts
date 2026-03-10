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
  const knowledgeBaseHtml = readDoc('knowledge-base.html');
  const integrationsHtml = readDoc('integrations.html');
  const architectureHtml = readDoc('architecture-diagrams.html');
  const readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

  expectIncludes(indexHtml, 'href="#documentation"', 'landing page should link to the documentation section');
  expectIncludes(indexHtml, 'href="knowledge-base.html"', 'landing page should link to the knowledge base');
  expectIncludes(indexHtml, 'href="integrations.html"', 'landing page should link to the integrations page');
  expectIncludes(indexHtml, 'href="architecture-diagrams.html"', 'landing page should link to the architecture diagrams page');
  expectIncludes(knowledgeBaseHtml, 'href="integrations.html"', 'knowledge base should link to integrations');
  expectIncludes(knowledgeBaseHtml, 'href="architecture-diagrams.html"', 'knowledge base should link to architecture diagrams');
  expectIncludes(knowledgeBaseHtml, 'Docs Home →', 'knowledge base should link back to docs home');
  expectIncludes(integrationsHtml, 'href="knowledge-base.html"', 'integrations page should link to knowledge base');
  expectIncludes(integrationsHtml, 'href="architecture-diagrams.html"', 'integrations page should link to architecture diagrams');
  expectIncludes(architectureHtml, 'href="knowledge-base.html"', 'architecture page should link to knowledge base');
  expectIncludes(architectureHtml, 'href="integrations.html"', 'architecture page should link to integrations');
  expectIncludes(architectureHtml, 'Diagram Index', 'architecture page should render the diagram sidebar');
  expectIncludes(readme, 'https://sir-ad.github.io/nexus-prime/', 'README should point to the public website');
  expectIncludes(readme, 'https://sir-ad.github.io/nexus-prime/knowledge-base.html', 'README should point to the public docs');
  assert.strictEqual(packageJson.homepage, 'https://sir-ad.github.io/nexus-prime/', 'package homepage should point to GitHub Pages');

  console.log('✅ Docs website navigation and metadata are wired correctly\n');
}

test();
