import assert from 'assert';
import fs from 'fs';
import path from 'path';

const PUBLIC_ROOTS = [
  'README.md',
  'docs',
  'releases',
  path.join('.github', 'workflows'),
];

const TEXT_EXTENSIONS = new Set(['.md', '.html', '.json', '.svg', '.yml', '.yaml', '.txt']);

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\/Users\//g, message: 'public surfaces should not leak macOS home-directory paths' },
  { pattern: /\/home\//g, message: 'public surfaces should not leak Linux home-directory paths' },
  { pattern: /C:\\Users\\/g, message: 'public surfaces should not leak Windows home-directory paths' },
  { pattern: /\bghp_[A-Za-z0-9]{20,}\b/g, message: 'public surfaces should not contain GitHub personal access tokens' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, message: 'public surfaces should not contain GitHub fine-grained tokens' },
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, message: 'public surfaces should not contain OpenAI-style API keys' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, message: 'public surfaces should not contain Slack-style tokens' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, message: 'public surfaces should not contain AWS access keys' },
  { pattern: /BEGIN [A-Z ]*PRIVATE KEY/g, message: 'public surfaces should not contain private keys' },
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, message: 'public surfaces should not contain email addresses by default' },
  { pattern: /(?:^|\s)GITHUB_TOKEN\s*=/gm, message: 'public surfaces should not contain credential-bearing config snippets' },
  { pattern: /(?:^|\s)NEXUSNET_GIST_ID\s*=/gm, message: 'public surfaces should not contain relay credential snippets' },
  { pattern: /NUXUS_PRIME_MCP/g, message: 'public docs should not contain the old setup typo' },
  { pattern: /20 MCP tools/g, message: 'public docs should not hardcode stale MCP tool counts' },
  { pattern: /v3\.0\.0 Stable/g, message: 'public docs should not present stale version banners as current state' },
  { pattern: /dashboard_v3\.0\.png/g, message: 'public docs should not reference the retired dashboard_v3.0 screenshot' },
  { pattern: /dashboard_v3\.8\.0\.png/g, message: 'public docs should not reference the retired dashboard_v3.8.0 screenshot' },
  { pattern: /neural_hud\.png/g, message: 'public docs should not reference the retired neural_hud screenshot' },
  { pattern: /swarm_trace\.png/g, message: 'public docs should not reference the retired swarm trace screenshot' },
  { pattern: /\bPhase 9\b/g, message: 'public docs should not present stale phase labels as active architecture' },
  { pattern: /\bEntanglement\b/g, message: 'public docs should not surface retired speculative architecture labels' },
  { pattern: /\bSuper Intellect\b/g, message: 'public docs should not surface retired speculative architecture labels' },
];

const ALLOWED_PUBLIC_EMAILS = new Set([
  'action@github.com',
]);

function collectFiles(root: string): string[] {
  const target = path.join(process.cwd(), root);
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const results: string[] = [];
  for (const entry of fs.readdirSync(target)) {
    const child = path.join(target, entry);
    const childStat = fs.statSync(child);
    if (childStat.isDirectory()) {
      results.push(...collectFiles(path.relative(process.cwd(), child)));
      continue;
    }
    if (TEXT_EXTENSIONS.has(path.extname(child))) {
      results.push(child);
    }
  }
  return results;
}

function test() {
  console.log('🧪 Scanning public surfaces for stale claims and sensitive content...\n');
  const files = PUBLIC_ROOTS.flatMap((root) => collectFiles(root));
  assert.ok(files.length > 0, 'expected public-surface files to exist');

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const { pattern, message } of BLOCKED_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = content.match(pattern);
      if (!matches || matches.length === 0) continue;
      if (message.includes('email addresses')) {
        const unexpected = matches.filter((match) => !ALLOWED_PUBLIC_EMAILS.has(match.toLowerCase()));
        assert.ok(unexpected.length === 0, `${message}: ${path.relative(process.cwd(), filePath)}`);
        continue;
      }
      assert.ok(false, `${message}: ${path.relative(process.cwd(), filePath)}`);
    }
  }

  const docsRoot = path.join(process.cwd(), 'docs');
  const indexHtml = fs.readFileSync(path.join(docsRoot, 'index.html'), 'utf8');
  const catalogHtml = fs.readFileSync(path.join(docsRoot, 'catalog.html'), 'utf8');
  const comparisonHtml = fs.readFileSync(path.join(docsRoot, 'comparison.html'), 'utf8');
  const knowledgeHtml = fs.readFileSync(path.join(docsRoot, 'knowledge-base.html'), 'utf8');
  const integrationsHtml = fs.readFileSync(path.join(docsRoot, 'integrations.html'), 'utf8');
  const architectureHtml = fs.readFileSync(path.join(docsRoot, 'architecture-diagrams.html'), 'utf8');
  const robots = path.join(docsRoot, 'robots.txt');
  const sitemap = path.join(docsRoot, 'sitemap.xml');

  assert.ok(indexHtml.includes('rel="canonical"'), 'landing page should declare a canonical URL');
  assert.ok(catalogHtml.includes('rel="canonical"'), 'catalog page should declare a canonical URL');
  assert.ok(indexHtml.includes('property="og:image"'), 'landing page should declare an og:image');
  assert.ok(indexHtml.includes('name="twitter:image"'), 'landing page should declare a Twitter preview image');
  assert.ok(indexHtml.includes('dashboard_cockpit_hero.png'), 'landing page should reference the current hero screenshot');
  assert.ok(indexHtml.includes('dashboard_runtime_sequence.png'), 'landing page should reference the runtime sequence screenshot');
  assert.ok(indexHtml.includes('dashboard_knowledge_trace.png'), 'landing page should reference the current knowledge screenshot');
  assert.ok(catalogHtml.includes('./assets/feature-registry.json'), 'catalog page should load the generated feature registry asset');
  assert.ok(comparisonHtml.includes('rel="canonical"'), 'comparison page should declare a canonical URL');
  assert.ok(comparisonHtml.includes('./assets/competitive-landscape.json'), 'comparison page should load the competitive landscape snapshot');
  assert.ok(knowledgeHtml.includes('rel="canonical"'), 'knowledge base should declare a canonical URL');
  assert.ok(integrationsHtml.includes('rel="canonical"'), 'integrations should declare a canonical URL');
  assert.ok(architectureHtml.includes('rel="canonical"'), 'architecture page should declare a canonical URL');
  assert.ok(!knowledgeHtml.includes('target="_blank">GitHub'), 'knowledge base GitHub CTA should include rel="noopener"');
  assert.ok(fs.existsSync(robots), 'docs should ship a robots.txt file');
  assert.ok(fs.existsSync(sitemap), 'docs should ship a sitemap.xml file');

  console.log('✅ Public docs, releases, and workflow files passed the surface scan\n');
}

test();
