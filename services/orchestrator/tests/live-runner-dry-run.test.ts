import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DryRunGitHubEngineeringTransport,
  EngineeringDryRunHarness,
  EngineeringRunner,
  GitHubEngineeringAdapter,
  GitWorktreeAdapter,
  LiveRunnerEnvironmentAdapter,
  RestrictedValidationAdapter,
  ScopedGitReviewAdapter,
  type EngineeringAuthorizationPort,
  type EngineeringModelRoutingPort,
  type EngineeringRunEvidenceRecord,
  type EngineeringTaskEnvelope,
  type EngineeringWorkerPort,
} from '../src/index.ts';

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

function run(command: string, args: readonly string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, [...args], {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 30_000,
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
      if (code !== 0) {
        rejectCommand(new Error(`Command failed: ${command} ${args.join(' ')} (${String(code)})`));
        return;
      }
      resolveCommand({ stdout, stderr });
    });
  });
}

function envelope(baseSha: string): EngineeringTaskEnvelope {
  return {
    runId: 'm03-live-dry-run-001',
    taskId: 'MILESTONE-03',
    objective: 'Demonstrate the safe live Engineering Runner dry-run loop.',
    baseSha,
    branch: 'milestone-03/dry-run-e2e',
    riskClass: 'R2',
    maxAttempts: 2,
    requiredChecks: ['git-diff-check'],
    modelSelection: {
      provider: 'yastroyka',
      model: 'deterministic-dry-run-worker',
      whyThisModel: 'Acceptance dry-run uses a deterministic worker without external provider credentials.',
      fallbackProviders: [],
    },
  };
}

test('restricted validation rejects mutation-capable Git commands', () => {
  assert.throws(
    () =>
      new RestrictedValidationAdapter({
        checks: {
          unsafe: {
            tool: 'git',
            args: ['push', 'origin', 'main'],
          },
        },
      }),
    /read-only Git operations/u,
  );
});

test(
  'live Linux runner completes an isolated bounded end-to-end dry-run',
  { skip: process.platform !== 'linux' },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'yastroyka-m03-live-'));
    const origin = join(root, 'origin.git');
    const repo = join(root, 'repo');
    const worktrees = join(root, 'worktrees');

    try {
      await mkdir(repo, { recursive: true });
      await run('git', ['init', '--bare', '--initial-branch=main', origin], root);
      await run('git', ['init', '--initial-branch=main'], repo);
      await run('git', ['config', 'user.name', 'YASTROYKA Dry Run'], repo);
      await run('git', ['config', 'user.email', 'dry-run@yastroyka.invalid'], repo);
      await writeFile(join(repo, 'README.md'), '# dry-run seed\n', 'utf8');
      await run('git', ['add', 'README.md'], repo);
      await run('git', ['commit', '-m', 'seed dry-run repository'], repo);
      await run('git', ['remote', 'add', 'origin', origin], repo);
      await run('git', ['push', '-u', 'origin', 'main'], repo);

      const baseSha = (await run('git', ['rev-parse', 'HEAD'], repo)).stdout.trim();
      assert.match(baseSha, /^[0-9a-f]{40}$/u);

      const authorization: EngineeringAuthorizationPort = {
        async assertAllowed() {},
      };
      const workspace = new GitWorktreeAdapter({ repoRoot: repo, worktreeRoot: worktrees });
      const modelRouting: EngineeringModelRoutingPort = {
        async route() {
          throw new Error('Model routing must not run when the dry-run envelope is pre-approved.');
        },
      };
      const worker: EngineeringWorkerPort = {
        async implement(input) {
          const outputDirectory = join(input.workspace.path, 'dry-run');
          const outputPath = join(outputDirectory, 'output.txt');
          await mkdir(outputDirectory, { recursive: true });
          await writeFile(
            outputPath,
            input.attempt === 1 ? 'intentional trailing whitespace  \n' : 'validated dry-run output\n',
            'utf8',
          );
          await run('git', ['add', 'dry-run/output.txt'], input.workspace.path);
          await run(
            'git',
            ['commit', '-m', `dry-run attempt ${String(input.attempt)}`],
            input.workspace.path,
          );
        },
      };
      const validation = new RestrictedValidationAdapter({
        checks: {
          'git-diff-check': {
            tool: 'git',
            args: ['diff', '--check', '{baseSha}..HEAD'],
          },
        },
      });
      const review = new ScopedGitReviewAdapter({ allowedPathPrefixes: ['dry-run'] });
      const github = new GitHubEngineeringAdapter(
        new DryRunGitHubEngineeringTransport({ pullRequestNumber: 901 }),
      );
      const evidenceRecords: EngineeringRunEvidenceRecord[] = [];
      const runner = new EngineeringRunner({
        authorization,
        workspace,
        modelRouting,
        worker,
        validation,
        review,
        github,
        evidence: {
          async record(record) {
            evidenceRecords.push(structuredClone(record));
          },
        },
        now: () => new Date('2026-08-25T09:30:00.000Z'),
      });
      const harness = new EngineeringDryRunHarness({
        runner,
        environment: new LiveRunnerEnvironmentAdapter({ runnerId: 'github-actions-dry-run' }),
        workspace,
      });

      const report = await harness.run(envelope(baseSha));

      assert.equal(report.dryRun, true);
      assert.equal(report.environment.platform, 'linux');
      assert.match(report.environment.nodeVersion, /^24\./u);
      assert.equal(report.environment.pnpmVersion, '11.20.0');
      assert.match(report.environment.gitVersion, /^git version /u);
      assert.equal(report.result.state.status, 'ready_for_owner_decision');
      assert.equal(report.result.state.decisionState, 'READY_FOR_OWNER_DECISION');
      assert.equal(report.result.state.attempt, 2);
      assert.equal(report.result.state.pullRequest?.number, 901);
      assert.equal(report.workspaceDisposed, true);
      assert.equal(report.decisionState, 'READY_FOR_OWNER_DECISION');

      assert.equal(
        evidenceRecords.some((record) => record.eventType === 'validation_failed'),
        true,
      );
      assert.equal(
        evidenceRecords.some((record) => record.eventType === 'validation_passed'),
        true,
      );
      assert.equal(evidenceRecords.at(-1)?.eventType, 'ci_passed');

      const finalHead = report.result.state.pullRequest?.headSha;
      assert.ok(finalHead);
      const pushedHead = (
        await run('git', ['--git-dir', origin, 'rev-parse', 'refs/heads/milestone-03/dry-run-e2e'], root)
      ).stdout.trim();
      assert.equal(pushedHead, finalHead);
      const pushedOutput = (
        await run(
          'git',
          ['--git-dir', origin, 'show', 'refs/heads/milestone-03/dry-run-e2e:dry-run/output.txt'],
          root,
        )
      ).stdout;
      assert.equal(pushedOutput, 'validated dry-run output\n');
      assert.equal((await run('git', ['rev-parse', 'main'], repo)).stdout.trim(), baseSha);

      assert.ok(report.result.workspace);
      await assert.rejects(() => access(report.result.workspace?.path ?? ''));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
