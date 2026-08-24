import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  GitHubEngineeringAdapter,
  GitWorktreeAdapter,
  type EngineeringCommandExecutor,
  type EngineeringCommandRequest,
  type EngineeringCommandResult,
  type EngineeringDraftPullRequestInput,
  type EngineeringTaskEnvelope,
  type GitHubCiTransportResult,
  type GitHubDraftPullRequestTransportResult,
  type GitHubEngineeringTransport,
} from '../src/index.ts';

const BASE_SHA = '68ea25ab85f000a8063ea7b1bc4c71df74d538c4';
const HEAD_SHA = '1111111111111111111111111111111111111111';
const OTHER_HEAD = '2222222222222222222222222222222222222222';

function envelope(overrides: Partial<EngineeringTaskEnvelope> = {}): EngineeringTaskEnvelope {
  return {
    runId: 'adapter-test-001',
    taskId: 'MILESTONE-03',
    objective: 'Exercise isolated engineering adapters.',
    baseSha: BASE_SHA,
    branch: 'milestone-03/adapter-test',
    riskClass: 'R2',
    maxAttempts: 2,
    requiredChecks: ['quality'],
    modelSelection: null,
    ...overrides,
  };
}

class FakeCommandExecutor implements EngineeringCommandExecutor {
  readonly requests: EngineeringCommandRequest[] = [];
  headSha = BASE_SHA;

  async run(request: EngineeringCommandRequest): Promise<EngineeringCommandResult> {
    this.requests.push(request);
    if (request.args[0] === 'rev-parse') {
      return { exitCode: 0, stdout: `${this.headSha}\n`, stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }
}

async function createWorktreeHarness(t: TestContext) {
  const repoRoot = await mkdtemp(join(tmpdir(), 'yastroyka-runner-'));
  const worktreeRoot = join(repoRoot, 'worktrees');
  const executor = new FakeCommandExecutor();
  const adapter = new GitWorktreeAdapter({ repoRoot, worktreeRoot, executor });
  t.after(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });
  return { adapter, executor, worktreeRoot };
}

test('Git worktree adapter creates an isolated branch from the exact base SHA', async (t) => {
  const { adapter, executor, worktreeRoot } = await createWorktreeHarness(t);
  const task = envelope();

  const workspace = await adapter.prepare(task);

  assert.equal(workspace.path, join(worktreeRoot, task.runId));
  assert.equal(workspace.branch, task.branch);
  assert.equal(workspace.baseSha, BASE_SHA);
  assert.deepEqual(
    executor.requests.slice(0, 3).map((request) => request.args),
    [
      ['check-ref-format', '--branch', task.branch],
      ['cat-file', '-e', `${BASE_SHA}^{commit}`],
      ['worktree', 'add', '-b', task.branch, workspace.path, BASE_SHA],
    ],
  );
  assert.equal(executor.requests[3]?.args[0], 'rev-parse');
});

test('feature push is exact-head, feature-only, and never force pushes', async (t) => {
  const { adapter, executor } = await createWorktreeHarness(t);
  const workspace = await adapter.prepare(envelope());
  executor.headSha = HEAD_SHA;

  await adapter.pushFeatureBranch(workspace, HEAD_SHA);

  const push = executor.requests.find((request) => request.args[0] === 'push');
  assert.deepEqual(push?.args, ['push', 'origin', `HEAD:refs/heads/${workspace.branch}`]);
  assert.equal(push?.args.includes('--force'), false);
  assert.equal(push?.args.includes('--force-with-lease'), false);
});

test('worktree cleanup removes only the isolated worktree and preserves the branch', async (t) => {
  const { adapter, executor } = await createWorktreeHarness(t);
  const workspace = await adapter.prepare(envelope());

  await adapter.dispose(workspace);

  const remove = executor.requests.find(
    (request) => request.args[0] === 'worktree' && request.args[1] === 'remove',
  );
  assert.deepEqual(remove?.args, ['worktree', 'remove', workspace.path]);
  assert.equal(
    executor.requests.some(
      (request) => request.args[0] === 'branch' && request.args.includes('-D'),
    ),
    false,
  );
});

test('worktree adapter rejects protected main and unsafe run identifiers before mutation', async (t) => {
  const { adapter, executor } = await createWorktreeHarness(t);

  await assert.rejects(() => adapter.prepare(envelope({ branch: 'main' })), /protected main/u);
  await assert.rejects(() => adapter.prepare(envelope({ runId: '../escape' })), /not safe/u);
  assert.deepEqual(executor.requests, []);
});

test('worktree adapter blocks push when HEAD moved after validation', async (t) => {
  const { adapter, executor } = await createWorktreeHarness(t);
  const workspace = await adapter.prepare(envelope());
  executor.headSha = OTHER_HEAD;

  await assert.rejects(
    () => adapter.pushFeatureBranch(workspace, HEAD_SHA),
    /HEAD moved before feature branch push/u,
  );
  assert.equal(
    executor.requests.some((request) => request.args[0] === 'push'),
    false,
  );
});

class FakeGitHubTransport implements GitHubEngineeringTransport {
  draftResult: GitHubDraftPullRequestTransportResult = {
    number: 12,
    headSha: HEAD_SHA,
    draft: true,
  };
  ciResult: GitHubCiTransportResult = {
    headSha: HEAD_SHA,
    status: 'completed',
    conclusion: 'success',
    reason: null,
  };
  publishedInput: EngineeringDraftPullRequestInput | null = null;
  waitedHead: string | null = null;

  async upsertDraftPullRequest(
    input: EngineeringDraftPullRequestInput,
  ): Promise<GitHubDraftPullRequestTransportResult> {
    this.publishedInput = input;
    return this.draftResult;
  }

  async waitForCommitCi(headSha: string): Promise<GitHubCiTransportResult> {
    this.waitedHead = headSha;
    return this.ciResult;
  }
}

function draftInput(): EngineeringDraftPullRequestInput {
  return {
    branch: 'milestone-03/adapter-test',
    baseBranch: 'main',
    headSha: HEAD_SHA,
    title: 'MILESTONE-03: adapter test',
    body: 'Draft only.',
  };
}

test('GitHub engineering adapter publishes Draft-only PRs and binds CI to exact head', async () => {
  const transport = new FakeGitHubTransport();
  const adapter = new GitHubEngineeringAdapter(transport);

  const pullRequest = await adapter.publishDraftPullRequest(draftInput());
  const ci = await adapter.waitForCi(pullRequest.number, HEAD_SHA);

  assert.deepEqual(pullRequest, { number: 12, headSha: HEAD_SHA, draft: true });
  assert.equal(transport.publishedInput?.baseBranch, 'main');
  assert.equal(transport.waitedHead, HEAD_SHA);
  assert.deepEqual(ci, {
    headSha: HEAD_SHA,
    conclusion: 'success',
    reason: null,
  });
});

test('GitHub engineering adapter fails closed if transport returns non-Draft PR', async () => {
  const transport = new FakeGitHubTransport();
  transport.draftResult = { number: 12, headSha: HEAD_SHA, draft: false };
  const adapter = new GitHubEngineeringAdapter(transport);

  await assert.rejects(() => adapter.publishDraftPullRequest(draftInput()), /non-Draft PR/u);
});

test('GitHub engineering adapter rejects non-terminal or wrong-head CI evidence', async () => {
  const transport = new FakeGitHubTransport();
  const adapter = new GitHubEngineeringAdapter(transport);

  transport.ciResult = {
    headSha: HEAD_SHA,
    status: 'in_progress',
    conclusion: null,
    reason: null,
  };
  await assert.rejects(() => adapter.waitForCi(12, HEAD_SHA), /non-terminal evidence/u);

  transport.ciResult = {
    headSha: OTHER_HEAD,
    status: 'completed',
    conclusion: 'success',
    reason: null,
  };
  await assert.rejects(() => adapter.waitForCi(12, HEAD_SHA), /different head SHA/u);
});
