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
  readonly expectedNodeMajor?: number;
  readonly expectedPnpmVersion?: string;
  readonly requireLinux?: boolean;
}

interface ToolResult {
  readonly exitCode: number;
  readonly stdout: string;
}

const RUNNER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;

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
  readonly #options: Required<LiveRunnerEnvironmentAdapterOptions>;

  constructor(options: LiveRunnerEnvironmentAdapterOptions) {
    requireRunnerId(options.runnerId);
    this.#options = {
      runnerId: options.runnerId,
      expectedNodeMajor: options.expectedNodeMajor ?? 24,
      expectedPnpmVersion: options.expectedPnpmVersion ?? '11.20.0',
      requireLinux: options.requireLinux ?? true,
    };
  }

  async inspect(): Promise<EngineeringRunnerEnvironment> {
    if (this.#options.requireLinux && process.platform !== 'linux') {
      throw new Error('Live Engineering Runner requires Linux.');
    }

    const nodeMajor = Number(process.versions.node.split('.')[0]);
    if (nodeMajor !== this.#options.expectedNodeMajor) {
      throw new Error(`Live Engineering Runner requires Node.js ${this.#options.expectedNodeMajor}.x.`);
    }

    const [pnpm, git] = await Promise.all([runTool('pnpm', ['--version']), runTool('git', ['--version'])]);
    const pnpmVersion = pnpm.stdout.trim();
    const gitVersion = git.stdout.trim();

    if (pnpm.exitCode !== 0 || pnpmVersion !== this.#options.expectedPnpmVersion) {
      throw new Error(`Live Engineering Runner requires pnpm ${this.#options.expectedPnpmVersion}.`);
    }
    if (git.exitCode !== 0 || !/^git version [0-9]+(?:\.[0-9]+){1,3}$/u.test(gitVersion)) {
      throw new Error('Live Engineering Runner requires a valid Git installation.');
    }

    return {
      runnerId: this.#options.runnerId,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.versions.node,
      pnpmVersion,
      gitVersion,
    };
  }
}
