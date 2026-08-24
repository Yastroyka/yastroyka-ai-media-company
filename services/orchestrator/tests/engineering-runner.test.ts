import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EngineeringRunner,
  type AutonomousEngineeringAction,
  type EngineeringAuthorizationPort,
  type EngineeringCheckEvidence,
  type EngineeringGitHubPort,
  type EngineeringReviewPort,
  type EngineeringTaskEnvelope,
  type EngineeringValidationPort,
  type EngineeringWorkerInput,
  type EngineeringWorkerPort,
  type EngineeringWorkspace,
  type EngineeringWorkspacePort,
} from '../src/index.ts';

const BASE_SHA = '68ea25ab85f000a8063ea7b1bc4c71df74d538c4';
const HEAD_ONE = '1111111111111111111111111111111111111111';
const HEAD_TWO = '2222222222222222222222222222222222222222';
const OTHER_HEAD = '3333333333333333333333333333333333333333';

const PASSED_CHECKS: readonly EngineeringCheckEvidence[] = [
  { name: 'quality', conclusion: 'passed' },
  { name: 'typecheck', conclusion: 'passed' },
  { name: 'test', conclusion: 'passed' },
];

function envelope(overrides: Partial<EngineeringTaskEnvelope> = {}): EngineeringTaskEnvelope {
  return {
    runId: 'runner-test-001',
    taskId: 'MILESTONE-03',
    objective: 'Exercise the bounded Engineering Runner.',
    baseSha: BASE_SHA,
    branch: 'milestone-03/runner-test',
    riskClass: 'R2',
    maxAttempts: 2,
    requiredChecks: ['quality', 'typecheck', 'test'],
    modelSelection: null,
    ...overrides,
  };
}

interface RunnerHarnessOptions {
  readonly validationResults?: readonly (readonly EngineeringCheckEvidence[])[];
  readonly ciConclusions?: readonly ('success' | 'failure')[];
  readonly denyAction?: AutonomousEngineeringAction;
  readonly reviewPassed?: boolean;
  readonly reviewReason?: string | null;
  readonly draftHeadOverride?: string;
}

function createHarness(options: RunnerHarnessOptions = {}) {
  const authorizationActions: AutonomousEngineeringAction[] = [];
  const workerInputs: EngineeringWorkerInput[] = [];
  const pushedHeads: string[] = [];
  const draftHeads: string[] = [];
  const ciHeads: string[] = [];
  let currentHead = BASE_SHA;
  let validationIndex = 0;
  let ciIndex = 0;

  const workspaceValue: EngineeringWorkspace = {
    path: '/runner/worktrees/runner-test-001',
    branch: 'milestone-03/runner-test',
    baseSha: BASE_SHA,
  };

  const authorization: EngineeringAuthorizationPort = {
    async assertAllowed(request) {
      authorizationActions.push(request.action);
      if (request.action === options.denyAction) {
        throw new Error('denied by test authorization');
      }
    },
  };

  const workspace: EngineeringWorkspacePort = {
    async prepare() {
      return workspaceValue;
    },
    async readHead() {
      return currentHead;
    },
    async pushFeatureBranch(_workspace, expectedHeadSha) {
      assert.equal(expectedHeadSha, currentHead);
      pushedHeads.push(expectedHeadSha);
    },
    async dispose() {},
  };

  const worker: EngineeringWorkerPort = {
    async implement(input) {
      workerInputs.push(input);
      currentHead = input.attempt === 1 ? HEAD_ONE : HEAD_TWO;
    },
  };

  const validation: EngineeringValidationPort = {
    async validate() {
      const result = options.validationResults?.[validationIndex] ?? PASSED_CHECKS;
      validationIndex += 1;
      return result;
    },
  };

  const review: EngineeringReviewPort = {
    async review() {
      return {
        passed: options.reviewPassed ?? true,
        reason: options.reviewReason ?? null,
      };
    },
  };

  const github: EngineeringGitHubPort = {
    async publishDraftPullRequest(input) {
      draftHeads.push(input.headSha);
      return {
        number: 11,
        headSha: options.draftHeadOverride ?? input.headSha,
        draft: true,
      };
    },
    async waitForCi(_prNumber, expectedHeadSha) {
      ciHeads.push(expectedHeadSha);
      const conclusion = options.ciConclusions?.[ciIndex] ?? 'success';
      ciIndex += 1;
      return {
        headSha: expectedHeadSha,
        conclusion,
        reason: conclusion === 'failure' ? 'untrusted raw CI output' : null,
      };
    },
  };

  return {
    runner: new EngineeringRunner({ authorization, workspace, worker, validation, review, github }),
    authorizationActions,
    workerInputs,
    pushedHeads,
    draftHeads,
    ciHeads,
  };
}

test('runner reaches owner decision through a Draft PR and exact-head CI', async () => {
  const harness = createHarness();
  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'ready_for_owner_decision');
  assert.equal(result.state.decisionState, 'READY_FOR_OWNER_DECISION');
  assert.deepEqual(result.state.pullRequest, {
    number: 11,
    headSha: HEAD_ONE,
    draft: true,
  });
  assert.deepEqual(harness.pushedHeads, [HEAD_ONE]);
  assert.deepEqual(harness.draftHeads, [HEAD_ONE]);
  assert.deepEqual(harness.ciHeads, [HEAD_ONE]);
  assert.deepEqual(harness.authorizationActions, [
    'create_feature_branch',
    'push_feature_branch',
    'create_or_update_draft_pr',
    'observe_ci',
  ]);
});

test('failed validation feeds one bounded correction attempt back to the worker', async () => {
  const harness = createHarness({
    validationResults: [
      [
        { name: 'quality', conclusion: 'failed' },
        { name: 'typecheck', conclusion: 'passed' },
        { name: 'test', conclusion: 'passed' },
      ],
      PASSED_CHECKS,
    ],
  });

  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'ready_for_owner_decision');
  assert.deepEqual(
    harness.workerInputs.map((input) => input.attempt),
    [1, 2],
  );
  assert.equal(
    harness.workerInputs[1]?.correctionReason,
    'Required validation check quality concluded failed.',
  );
  assert.deepEqual(harness.pushedHeads, [HEAD_TWO]);
});

test('failed exact-head CI can be corrected within the same bounded run', async () => {
  const harness = createHarness({ ciConclusions: ['failure', 'success'] });

  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'ready_for_owner_decision');
  assert.deepEqual(
    harness.workerInputs.map((input) => input.attempt),
    [1, 2],
  );
  assert.equal(
    harness.workerInputs[1]?.correctionReason,
    `GitHub CI failed for exact head ${HEAD_ONE}.`,
  );
  assert.deepEqual(harness.pushedHeads, [HEAD_ONE, HEAD_TWO]);
  assert.deepEqual(harness.draftHeads, [HEAD_ONE, HEAD_TWO]);
  assert.deepEqual(harness.ciHeads, [HEAD_ONE, HEAD_TWO]);
  assert.deepEqual(result.state.pullRequest, {
    number: 11,
    headSha: HEAD_TWO,
    draft: true,
  });
});

test('authorization denial fails closed before the denied mutation', async () => {
  const harness = createHarness({ denyAction: 'push_feature_branch' });

  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'blocked');
  assert.equal(result.state.decisionState, 'BLOCKED');
  assert.equal(result.state.blockerReason, 'Engineering runner failed closed during feature branch push.');
  assert.deepEqual(harness.pushedHeads, []);
  assert.deepEqual(harness.draftHeads, []);
  assert.deepEqual(harness.ciHeads, []);
});

test('Draft PR head mismatch blocks CI observation', async () => {
  const harness = createHarness({ draftHeadOverride: OTHER_HEAD });

  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'blocked');
  assert.match(result.state.blockerReason ?? '', /does not match pushed head/u);
  assert.deepEqual(harness.ciHeads, []);
});

test('untrusted review text is not copied into canonical blocker state', async () => {
  const harness = createHarness({
    reviewPassed: false,
    reviewReason: 'token=should-not-enter-run-state',
  });

  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'blocked');
  assert.equal(
    result.state.blockerReason,
    'Independent engineering review reported blocking findings.',
  );
  assert.doesNotMatch(result.state.blockerReason ?? '', /token=/u);
  assert.deepEqual(harness.pushedHeads, []);
});
