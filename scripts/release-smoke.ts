import { spawn } from 'node:child_process';

interface SmokeExpectation {
  label: string;
  command: string;
  args: string[];
  timeoutMs?: number;
  expectAny?: string[];
  allowTimeout?: boolean;
}

interface SmokeResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}

function runStep(step: SmokeExpectation): Promise<SmokeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let settled = false;
    let timedOut = false;
    const timeoutMs = step.timeoutMs ?? 0;

    const finalize = (exitCode: number | null, error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve({ output, exitCode, timedOut });
    };

    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', (error) => finalize(null, error));
    child.on('close', (code) => finalize(code));

    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!settled) child.kill('SIGKILL');
          }, 1000);
        }, timeoutMs)
      : null;
  });
}

function assertStep(step: SmokeExpectation, result: SmokeResult): void {
  const matchesExpectation = !step.expectAny?.length || step.expectAny.some((snippet) => result.output.includes(snippet));
  if (!matchesExpectation) {
    throw new Error(`${step.label} did not emit an expected marker.\n\nOutput:\n${result.output}`);
  }
  if (result.timedOut && !step.allowTimeout) {
    throw new Error(`${step.label} timed out unexpectedly.\n\nOutput:\n${result.output}`);
  }
  if (!result.timedOut && result.exitCode !== 0) {
    throw new Error(`${step.label} exited with code ${String(result.exitCode)}.\n\nOutput:\n${result.output}`);
  }
}

async function main(): Promise<void> {
  const steps: SmokeExpectation[] = [
    {
      label: 'Bootstrap manifest',
      command: 'node',
      args: ['dist/cli.js', 'bootstrap', 'status'],
      expectAny: ['"clients"'],
    },
    {
      label: 'Client setup status',
      command: 'node',
      args: ['dist/cli.js', 'setup', 'status'],
      expectAny: ['Integration Status'],
    },
    {
      label: 'MCP startup smoke',
      command: 'node',
      args: ['dist/cli.js', 'mcp'],
      timeoutMs: 12000,
      allowTimeout: true,
      expectAny: ['MCP Server running on stdio'],
    },
    {
      label: 'Dashboard boot smoke',
      command: 'node',
      args: ['dist/cli.js', 'start'],
      timeoutMs: 12000,
      allowTimeout: true,
      expectAny: ['Topology console listening', 'Reusing compatible dashboard', 'New dashboard started at'],
    },
  ];

  for (const step of steps) {
    process.stdout.write(`• ${step.label}... `);
    const result = await runStep(step);
    assertStep(step, result);
    process.stdout.write('ok\n');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
