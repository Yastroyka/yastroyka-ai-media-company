import { spawn } from 'node:child_process';

import type { EngineeringCheckEvidence } from '../engineering-run.ts';
import type { EngineeringValidationPort, EngineeringWorkspace } from '../engineering-runner.ts';

export interface RestrictedValidationCommand {
  readonly tool: 'git' | 'pnpm';
  readonly args: readonly string[];
}

export interface RestrictedValidationAdapterOptions {
  readonly checks: Readonly<Record<string, RestrictedValidationCommand>>;
  readonly allowedPnpmScripts?: readonly string[];
  readonly timeoutMs?: number;
}

const CHECK_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u;
const SAFE_PNPM_SCRIPT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u;

function requireCheckName(value: string): void {
  if (!CHECK_NAME_PATTERN.test(value)) {
    throw new Error(
      'Validation check name must be a safe identifier no longer than 80 characters.',
    );
  }
}

function sameArgs(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

function validateGitCommand(args: readonly string[]): void {
  const allowed =
    sameArgs(args, ['diff', '--check', '{baseSha}..HEAD']) ||
    sameArgs(args, ['rev-parse', 'HEAD']) ||
    sameArgs(args, ['status', '--porcelain=v1', '--untracked-files=all']);

  if (!allowed) {
    throw new Error('Restricted validation permits only approved read-only Git command forms.');
  }
}

function validateCommand(
  command: RestrictedValidationCommand,
  allowedPnpmScripts: ReadonlySet<string>,
): void {
  if (command.args.length === 0 || command.args.some((arg) => arg.includes('\u0000'))) {
    throw new Error('Restricted validation command contains invalid arguments.');
  }

  if (command.tool === 'git') {
    validateGitCommand(command.args);
    return;
  }

  if (command.args.length !== 2 || command.args[0] !== 'run') {
    throw new Error('Restricted pnpm validation must use exactly `pnpm run <script>`.');
  }
  const script = command.args[1] ?? '';
  if (!SAFE_PNPM_SCRIPT_PATTERN.test(script) || !allowedPnpmScripts.has(script)) {
    throw new Error('Restricted pnpm validation script is not explicitly approved.');
  }
}

function materializeArgs(
  command: RestrictedValidationCommand,
  workspace: EngineeringWorkspace,
): readonly string[] {
  return command.args.map((arg) => arg.replaceAll('{baseSha}', workspace.baseSha));
}

function runCommand(
  workspace: EngineeringWorkspace,
  command: RestrictedValidationCommand,
  timeoutMs: number,
): Promise<number> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command.tool, [...materializeArgs(command, workspace)], {
      cwd: workspace.path,
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });

    child.once('error', rejectCommand);
    child.once('close', (code) => {
      resolveCommand(code ?? 1);
    });
  });
}

export class RestrictedValidationAdapter implements EngineeringValidationPort {
  readonly #checks: Readonly<Record<string, RestrictedValidationCommand>>;
  readonly #timeoutMs: number;

  constructor(options: RestrictedValidationAdapterOptions) {
    if (!Number.isInteger(options.timeoutMs ?? 120_000) || (options.timeoutMs ?? 120_000) < 1) {
      throw new Error('timeoutMs must be a positive integer.');
    }

    const allowedPnpmScripts = new Set(options.allowedPnpmScripts ?? []);
    for (const script of allowedPnpmScripts) {
      if (!SAFE_PNPM_SCRIPT_PATTERN.test(script)) {
        throw new Error('allowedPnpmScripts contains an invalid script name.');
      }
    }

    for (const [name, command] of Object.entries(options.checks)) {
      requireCheckName(name);
      validateCommand(command, allowedPnpmScripts);
    }

    this.#checks = options.checks;
    this.#timeoutMs = options.timeoutMs ?? 120_000;
  }

  async validate(
    workspace: EngineeringWorkspace,
    requiredChecks: readonly string[],
  ): Promise<readonly EngineeringCheckEvidence[]> {
    const evidence: EngineeringCheckEvidence[] = [];

    for (const name of requiredChecks) {
      requireCheckName(name);
      const command = this.#checks[name];
      if (command === undefined) {
        evidence.push({ name, conclusion: 'not_run' });
        continue;
      }

      try {
        const exitCode = await runCommand(workspace, command, this.#timeoutMs);
        evidence.push({ name, conclusion: exitCode === 0 ? 'passed' : 'failed' });
      } catch {
        evidence.push({ name, conclusion: 'failed' });
      }
    }

    return evidence;
  }
}
