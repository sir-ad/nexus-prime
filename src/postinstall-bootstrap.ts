import path from 'path';
import { fileURLToPath } from 'url';
import { ensureBootstrap } from './engines/client-bootstrap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.join(__dirname, '..');

try {
  if (process.env.NEXUS_BOOTSTRAP_DISABLE === '1') {
    process.exit(0);
  }
  ensureBootstrap({
    packageRoot,
    workspaceRoot: process.cwd(),
    phase: 'install',
    silent: true,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[nexus-prime] postinstall bootstrap skipped: ${message}`);
}
