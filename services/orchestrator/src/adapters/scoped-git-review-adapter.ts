import { spawn } from 'node:child_process';

import type {
  EngineeringReviewPort,
  EngineeringReviewResult,
  EngineeringWorkspace,
} from '../engineering-runner.ts';

export interface ScopedGitReviewAdapterOptions {
  readonly allowedPathPrefixes: readonly string[];
  readonly forbiddenPathPrefixes?: readonly string[];
  readonly timeoutMs?: number;
}

interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DEFAULT_FORBIDDEN_PREFIXES = [
  '.env',
  '.git/',
  '.github/',
  '.codex/',
  '.ai/',
  'AGENTS.md',
  'SECURITY.md',
  'docs/PROJECT_CONSTITUTION.md',
  'docs/ENGINEERING_RULES.md',
  'docs/agentic/AGENT_EXECUTION_CONTRACT.md',
];

function requireSafePrefix(value: string): void {
  if (
    value.length === 0 ||
    value.startsWith('/') ||
    value === '..' ||
    value.startsWith('../') ||
    value.includes('\u0000')
  ) {
    throw new Error('Review path prefix must be a safe repository-relative prefix.');
  }
}

function requireSha(value: string): void {
  if (!SHA_PATTERN.test(value)) {
    throw new Error('Review head SHA must be an exact 40-character lowercase Git SHA.');
  }
}

function runGit(
  workspace: EngineeringWorkspace,
  args: readonly string[],
  timeoutMs: number,
): Promise<GitResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn('git', [...args], {
      cwd: workspace.path,
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
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

function isWithinPrefix(path: string, prefix: string): boolean {
  if (prefix === '.env') {
    return path === '.env' || path.startsWith('.env.');
  }
  return path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}

export class ScopedGitReviewAdapter implements EngineeringReviewPort {
  readonly #allowedPathPrefixes: readonly string[];
  readonly #forbiddenPathPrefixes: readonly string[];
  readonly #timeoutMs: number;

  constructor(options: ScopedGitReviewAdapterOptions) {
    if (options.allowedPathPrefixes.length === 0) {
      throw new Error('At least one allowed review path prefix is required.');
    }
    for (const prefix of options.allowedPathPrefixes) {
      requireSafePrefix(prefix);
    }

    const forbiddenPathPrefixes = [
      ...DEFAULT_FORBIDDEN_PREFIXES,
      ...(options.forbiddenPathPrefixes ?? []),
    ];
    for (const prefix of forbiddenPathPrefixes) {
      requireSafePrefix(prefix);
    }
    if (!Number.isInteger(options.timeoutMs ?? 30_000) || (options.timeoutMs ?? 30_000) < 1) {
      throw new Error('timeoutMs must be a positive integer.');
    }

    this.#allowedPathPrefixes = [...options.allowedPathPrefixes];
    this.#forbiddenPathPrefixes = [...new Set(forbiddenPathPrefixes)];
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async review(workspace: EngineeringWorkspace, headSha: string): Promise<EngineeringReviewResult> {
    requireSha(headSha);
    requireSha(workspace.baseSha);

    try {
      const head = await runGit(workspace, ['rev-parse', 'HEAD'], this.#timeoutMs);
      if (head.exitCode !== 0 || head.stdout.trim() !== headSha) {
        return { passed: false, reason: 'Review head mismatch.' };
      }

      const ancestry = await runGit(
        workspace,
        ['merge-base', '--is-ancestor', workspace.baseSha, headSha],
        this.#timeoutMs,
      );
      if (ancestry.exitCode !== 0) {
        return { passed: false, reason: 'Review head is not descended from the approved base.' };
      }

      const changed = await runGit(
        workspace,
        [
          'diff',
          '--name-only',
          '-z',
          '--no-renames',
          '--no-ext-diff',
          '--no-textconv',
          `${workspace.baseSha}..${headSha}`,
        ],
        this.#timeoutMs,
      );
      if (changed.exitCode !== 0) {
        return { passed: false, reason: 'Review diff could not be read.' };
      }

      const paths = changed.stdout.split('\u0000').filter((path) => path.length > 0);
      if (paths.length === 0) {
        return { passed: false, reason: 'Review found no changed files.' };
      }

      for (const path of paths) {
        if (path.startsWith('/') || path === '..' || path.startsWith('../')) {
          return { passed: false, reason: 'Review found an unsafe changed path.' };
        }
        if (this.#forbiddenPathPrefixes.some((prefix) => isWithinPrefix(path, prefix))) {
          return { passed: false, reason: 'Review found a forbidden changed path.' };
        }
        if (!this.#allowedPathPrefixes.some((prefix) => isWithinPrefix(path, prefix))) {
          return { passed: false, reason: 'Review found a change outside approved scope.' };
        }
      }

      return { passed: true, reason: null };
    } catch {
      return { passed: false, reason: 'Review execution failed closed.' };
    }
  }
}
