import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { assertAutonomousEngineeringActionAllowed } from '../engineering-run.ts';
import type { EngineeringWorkspace, EngineeringWorkspacePort } from '../engineering-runner.ts';
import type { EngineeringTaskEnvelope } from '../engineering-run.ts';

export interface EngineeringGitCommandRequest {
  readonly cwd: string;
  readonly args: readonly string[];
}

export interface EngineeringGitCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface EngineeringGitCommandExecutor {
  run(request: EngineeringGitCommandRequest): Promise<EngineeringGitCommandResult>;
}

class NodeEngineeringGitCommandExecutor implements EngineeringGitCommandExecutor {
  run(request: EngineeringGitCommandRequest): Promise<EngineeringGitCommandResult> {
    return new Promise((resolveCommand, rejectCommand) => {
      const child = spawn('git', [...request.args], {
        cwd: request.cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.once('error', rejectCommand);
      child.once('close', (code) => {
        resolveCommand({
          exitCode: code ?? 1,
          stdout,
          stderr,
        });
      });
    });
  }
}

export class EngineeringCommandError extends Error {
  readonly operation: string;
  readonly exitCode: number;

  constructor(operation: string, exitCode: number) {
    super(`Engineering command failed during ${operation} with exit code ${exitCode}.`);
    this.name = 'EngineeringCommandError';
    this.operation = operation;
    this.exitCode = exitCode;
  }
}

export interface GitWorktreeAdapterOptions {
  readonly repoRoot: string;
  readonly worktreeRoot: string;
  readonly executor?: EngineeringGitCommandExecutor;
}

interface PreparedWorkspaceIdentity {
  readonly branch: string;
  readonly baseSha: string;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;

function requireSha(value: string, field: string): void {
  if (!SHA_PATTERN.test(value)) {
    throw new Error(`${field} must be an exact 40-character lowercase Git SHA.`);
  }
}

function requireRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error('runId is not safe for an isolated worktree directory.');
  }
}

function requireFeatureBranch(branch: string): void {
  if (branch === 'main' || branch === 'refs/heads/main') {
    throw new Error('Engineering worktree cannot target protected main.');
  }
}

function requireAbsoluteRoot(value: string, field: string): string {
  if (!isAbsolute(value)) {
    throw new Error(`${field} must be an absolute path.`);
  }
  return resolve(value);
}

function requireContainedPath(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);
  if (
    relativePath.length === 0 ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('Engineering worktree path escapes or aliases the configured worktree root.');
  }
}

export class GitWorktreeAdapter implements EngineeringWorkspacePort {
  readonly #repoRoot: string;
  readonly #worktreeRoot: string;
  readonly #executor: EngineeringGitCommandExecutor;
  readonly #preparedWorkspaces = new Map<string, PreparedWorkspaceIdentity>();

  constructor(options: GitWorktreeAdapterOptions) {
    this.#repoRoot = requireAbsoluteRoot(options.repoRoot, 'repoRoot');
    this.#worktreeRoot = requireAbsoluteRoot(options.worktreeRoot, 'worktreeRoot');
    this.#executor = options.executor ?? new NodeEngineeringGitCommandExecutor();
  }

  async prepare(envelope: EngineeringTaskEnvelope): Promise<EngineeringWorkspace> {
    assertAutonomousEngineeringActionAllowed('create_feature_branch');
    requireFeatureBranch(envelope.branch);
    requireRunId(envelope.runId);
    requireSha(envelope.baseSha, 'baseSha');

    const worktreePath = resolve(this.#worktreeRoot, envelope.runId);
    requireContainedPath(this.#worktreeRoot, worktreePath);

    await this.#runOrThrow(
      {
        cwd: this.#repoRoot,
        args: ['check-ref-format', '--branch', envelope.branch],
      },
      'feature branch validation',
    );
    await this.#runOrThrow(
      {
        cwd: this.#repoRoot,
        args: ['cat-file', '-e', `${envelope.baseSha}^{commit}`],
      },
      'base SHA verification',
    );

    await mkdir(this.#worktreeRoot, { recursive: true });
    await this.#runOrThrow(
      {
        cwd: this.#repoRoot,
        args: ['worktree', 'add', '-b', envelope.branch, worktreePath, envelope.baseSha],
      },
      'isolated worktree creation',
    );

    const workspace: EngineeringWorkspace = {
      path: worktreePath,
      branch: envelope.branch,
      baseSha: envelope.baseSha,
    };
    this.#preparedWorkspaces.set(worktreePath, {
      branch: envelope.branch,
      baseSha: envelope.baseSha,
    });

    const headSha = await this.readHead(workspace);
    if (headSha !== envelope.baseSha) {
      this.#preparedWorkspaces.delete(worktreePath);
      throw new Error('Created worktree does not point to the exact approved base SHA.');
    }

    return workspace;
  }

  async readHead(workspace: EngineeringWorkspace): Promise<string> {
    const workspacePath = this.#assertWorkspace(workspace);
    const result = await this.#runOrThrow(
      {
        cwd: workspacePath,
        args: ['rev-parse', 'HEAD'],
      },
      'worktree HEAD read',
    );
    const headSha = result.stdout.trim();
    requireSha(headSha, 'worktree HEAD');
    return headSha;
  }

  async pushFeatureBranch(workspace: EngineeringWorkspace, expectedHeadSha: string): Promise<void> {
    assertAutonomousEngineeringActionAllowed('push_feature_branch');
    const workspacePath = this.#assertWorkspace(workspace);
    requireSha(expectedHeadSha, 'expectedHeadSha');

    const currentHeadSha = await this.readHead(workspace);
    if (currentHeadSha !== expectedHeadSha) {
      throw new Error('Worktree HEAD moved before feature branch push.');
    }

    await this.#runOrThrow(
      {
        cwd: workspacePath,
        args: ['push', 'origin', `HEAD:refs/heads/${workspace.branch}`],
      },
      'feature branch push',
    );
  }

  async dispose(workspace: EngineeringWorkspace): Promise<void> {
    const workspacePath = this.#assertWorkspace(workspace);
    await this.#runOrThrow(
      {
        cwd: this.#repoRoot,
        args: ['worktree', 'remove', workspacePath],
      },
      'worktree removal',
    );
    this.#preparedWorkspaces.delete(workspacePath);
  }

  #assertWorkspace(workspace: EngineeringWorkspace): string {
    requireFeatureBranch(workspace.branch);
    requireSha(workspace.baseSha, 'workspace.baseSha');
    const workspacePath = resolve(workspace.path);
    requireContainedPath(this.#worktreeRoot, workspacePath);

    const prepared = this.#preparedWorkspaces.get(workspacePath);
    if (
      prepared === undefined ||
      prepared.branch !== workspace.branch ||
      prepared.baseSha !== workspace.baseSha
    ) {
      throw new Error('Engineering workspace was not prepared by this adapter instance.');
    }

    return workspacePath;
  }

  async #runOrThrow(
    request: EngineeringGitCommandRequest,
    operation: string,
  ): Promise<EngineeringGitCommandResult> {
    const result = await this.#executor.run(request);
    if (result.exitCode !== 0) {
      throw new EngineeringCommandError(operation, result.exitCode);
    }
    return result;
  }
}
