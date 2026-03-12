import assert from 'assert';
import fs from 'fs';
import path from 'path';

const PUBLIC_ROOTS = [
  'README.md',
  'docs',
  'releases',
  path.join('.github', 'workflows'),
];

const TEXT_EXTENSIONS = new Set(['.md', '.html', '.svg', '.yml', '.yaml', '.txt']);

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

  console.log('✅ Public docs, releases, and workflow files passed the surface scan\n');
}

test();
