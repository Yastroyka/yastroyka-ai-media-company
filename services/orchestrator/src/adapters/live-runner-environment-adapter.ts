import { spawn } from 'node:child_process';

export interface EngineeringRunnerEnvironment {
  readonly runnerId: string;
  readonly platform: string;
  readonly arch: string;
  readonly nodeVersion: string;
  readonly pnpmVersion: string;
  readonly gitVersion: string;
}

export interface EngineeringRunnerEnvironmentPort {
  inspect(): Promise<EngineeringRunnerEnvironment>;
}

export interface LiveRunnerEnvironmentAdapterOptions {
  readonly runnerId: string;
}

interface ToolResult {
  readonly exitCode: number;
  readonly stdout: string;
}

const RUNNER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const REQUIRED_NODE_MAJOR = 24;
const REQUIRED_PNPM_VERSION = '11.20.0';

function requireRunnerId(value: string): void {
  if (!RUNNER_ID_PATTERN.test(value)) {
    throw new Error('runnerId must be a safe identifier no longer than 80 characters.');
  }
}

function runTool(command: 'git' | 'pnpm', args: readonly string[]): Promise<ToolResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, [...args], {
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 30_000,
    });
    let stdout = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.once('error', rejectCommand);
    child.once('close', (code) => {
      resolveCommand({ exitCode: code ?? 1, stdout });
    });
  });
}

export class LiveRunnerEnvironmentAdapter implements EngineeringRunnerEnvironmentPort {
  readonly #runnerId: string;

  constructor(options: LiveRunnerEnvironmentAdapterOptions) {
    requireRunnerId(options.runnerId);
    this.#runnerId = options.runnerId;
  }

  async inspect(): Promise<EngineeringRunnerEnvironment> {
    if (process.platform !== 'linux') {
      throw new Error('Live Engineering Runner requires Linux.');
    }

    const nodeMajor = Number(process.versions.node.split('.')[0]);
    if (nodeMajor !== REQUIRED_NODE_MAJOR) {
      throw new Error(`Live Engineering Runner requires Node.js ${REQUIRED_NODE_MAJOR}.x.`);
    }

    const [pnpm, git] = await Promise.all([
      runTool('pnpm', ['--version']),
      runTool('git', ['--version']),
    ]);
    const pnpmVersion = pnpm.stdout.trim();
    const gitVersion = git.stdout.trim();

    if (pnpm.exitCode !== 0 || pnpmVersion !== REQUIRED_PNPM_VERSION) {
      throw new Error(`Live Engineering Runner requires pnpm ${REQUIRED_PNPM_VERSION}.`);
    }
    if (git.exitCode !== 0 || !/^git version [0-9]+(?:\.[0-9]+){1,3}$/u.test(gitVersion)) {
      throw new Error('Live Engineering Runner requires a valid Git installation.');
    }

    return {
      runnerId: this.#runnerId,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.versions.node,
      pnpmVersion,
      gitVersion,
    };
  }
}
