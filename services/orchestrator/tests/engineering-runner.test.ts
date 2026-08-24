import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EngineeringProviderUnavailableError,
  EngineeringRunner,
  type AutonomousEngineeringAction,
  type EngineeringAuthorizationPort,
  type EngineeringCheckEvidence,
  type EngineeringGitHubPort,
  type EngineeringModelCandidate,
  type EngineeringModelRoutingPort,
  type EngineeringReviewPort,
  type EngineeringRunEvidenceRecord,
  type EngineeringTaskEnvelope,
  type EngineeringValidationPort,
  type EngineeringWorkerInput,
  type EngineeringWorkerPort,
  type EngineeringWorkspace,
  type EngineeringWorkspacePort,
} from '../src/index.ts';

const BASE_SHA = 'a8cc2df1ce99e140f7d1e2ce093ff0a57bcde453';
const HEAD_ONE = '1111111111111111111111111111111111111111';
const HEAD_TWO = '2222222222222222222222222222222222222222';
const OTHER_HEAD = '3333333333333333333333333333333333333333';
const RECORDED_AT = '2026-08-24T21:30:00.000Z';

const PRIMARY_MODEL: EngineeringModelCandidate = {
  provider: 'openai',
  model: 'codex-engineering',
  revision: 'r1',
};
const FALLBACK_MODEL: EngineeringModelCandidate = {
  provider: 'deepseek',
  model: 'deepseek-coder',
  revision: 'r1',
};

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
  readonly validationHeadMutation?: string;
  readonly reviewHeadMutation?: string;
  readonly unavailableModels?: readonly string[];
  readonly workerErrorModel?: string;
  readonly routingFailure?: boolean;
  readonly evidenceFailureEvent?: EngineeringRunEvidenceRecord['eventType'];
}

function createHarness(options: RunnerHarnessOptions = {}) {
  const authorizationActions: AutonomousEngineeringAction[] = [];
  const workerInputs: EngineeringWorkerInput[] = [];
  const reviewHeads: string[] = [];
  const pushedHeads: string[] = [];
  const draftHeads: string[] = [];
  const ciHeads: string[] = [];
  const evidenceRecords: EngineeringRunEvidenceRecord[] = [];
  let validationCalls = 0;
  let workspacePrepareCalls = 0;
  let routingCalls = 0;
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
      workspacePrepareCalls += 1;
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

  const modelRouting: EngineeringModelRoutingPort = {
    async route() {
      routingCalls += 1;
      if (options.routingFailure === true) {
        throw new Error('no eligible candidate');
      }
      return {
        winner: PRIMARY_MODEL,
        fallbacks: [FALLBACK_MODEL],
        whyThisModel: 'Primary engineering model ranked first with an approved fallback.',
      };
    },
  };

  const worker: EngineeringWorkerPort = {
    async implement(input) {
      workerInputs.push(input);
      if (options.workerErrorModel === input.model.model) {
        throw new Error('ordinary worker failure');
      }
      if (options.unavailableModels?.includes(input.model.model) === true) {
        throw new EngineeringProviderUnavailableError();
      }
      currentHead = input.attempt === 1 ? HEAD_ONE : HEAD_TWO;
    },
  };

  const validation: EngineeringValidationPort = {
    async validate() {
      validationCalls += 1;
      const result = options.validationResults?.[validationIndex] ?? PASSED_CHECKS;
      validationIndex += 1;
      if (options.validationHeadMutation !== undefined) {
        currentHead = options.validationHeadMutation;
      }
      return result;
    },
  };

  const review: EngineeringReviewPort = {
    async review(_workspace, headSha) {
      reviewHeads.push(headSha);
      if (options.reviewHeadMutation !== undefined) {
        currentHead = options.reviewHeadMutation;
      }
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

  const evidence = {
    async record(record: EngineeringRunEvidenceRecord) {
      if (record.eventType === options.evidenceFailureEvent) {
        throw new Error('evidence store unavailable');
      }
      evidenceRecords.push(structuredClone(record));
    },
  };

  return {
    runner: new EngineeringRunner({
      authorization,
      workspace,
      modelRouting,
      worker,
      validation,
      review,
      github,
      evidence,
      now: () => new Date(RECORDED_AT),
    }),
    authorizationActions,
    workerInputs,
    reviewHeads,
    pushedHeads,
    draftHeads,
    ciHeads,
    evidenceRecords,
    get validationCalls() {
      return validationCalls;
    },
    get workspacePrepareCalls() {
      return workspacePrepareCalls;
    },
    get routingCalls() {
      return routingCalls;
    },
  };
}

test('runner reaches owner decision through routed model, Draft PR, exact-head CI, and evidence', async () => {
  const harness = createHarness();
  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'ready_for_owner_decision');
  assert.equal(result.state.decisionState, 'READY_FOR_OWNER_DECISION');
  assert.deepEqual(result.state.modelSelection, {
    provider: 'openai',
    model: 'codex-engineering',
    whyThisModel: 'Primary engineering model ranked first with an approved fallback.',
    fallbackProviders: ['deepseek'],
  });
  assert.deepEqual(result.state.pullRequest, {
    number: 11,
    headSha: HEAD_ONE,
    draft: true,
  });
  assert.deepEqual(
    harness.workerInputs.map((input) => input.model),
    [PRIMARY_MODEL],
  );
  assert.deepEqual(harness.reviewHeads, [HEAD_ONE]);
  assert.deepEqual(harness.pushedHeads, [HEAD_ONE]);
  assert.deepEqual(harness.draftHeads, [HEAD_ONE]);
  assert.deepEqual(harness.ciHeads, [HEAD_ONE]);
  assert.deepEqual(harness.authorizationActions, [
    'create_feature_branch',
    'run_validation',
    'push_feature_branch',
    'create_or_update_draft_pr',
    'observe_ci',
  ]);
  assert.equal(harness.evidenceRecords[0]?.eventType, 'model_selected');
  assert.deepEqual(harness.evidenceRecords[0]?.payload.routingDecision, {
    winner: PRIMARY_MODEL,
    fallbacks: [FALLBACK_MODEL],
    whyThisModel: 'Primary engineering model ranked first with an approved fallback.',
  });
  assert.equal(harness.evidenceRecords.at(-1)?.eventType, 'ci_passed');
  assert.deepEqual(
    harness.evidenceRecords.map((record) => record.sequence),
    harness.evidenceRecords.map((_record, index) => index + 1),
  );
  assert.equal(JSON.stringify(harness.evidenceRecords).includes('untrusted raw CI output'), false);
});

test('provider outage switches to approved fallback without consuming correction attempt', async () => {
  const harness = createHarness({ unavailableModels: [PRIMARY_MODEL.model] });

  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'ready_for_owner_decision');
  assert.deepEqual(
    harness.workerInputs.map((input) => [input.model.model, input.attempt]),
    [
      [PRIMARY_MODEL.model, 1],
      [FALLBACK_MODEL.model, 1],
    ],
  );
  const fallbackEvidence = harness.evidenceRecords.find(
    (record) => record.eventType === 'model_fallback',
  );
  assert.deepEqual(fallbackEvidence?.payload.activeModel, FALLBACK_MODEL);
  assert.equal(harness.validationCalls, 1);
});

test('all routed models unavailable fails closed before validation', async () => {
  const harness = createHarness({
    unavailableModels: [PRIMARY_MODEL.model, FALLBACK_MODEL.model],
  });

  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'blocked');
  assert.equal(
    result.state.blockerReason,
    'No eligible engineering model remained available for worker execution.',
  );
  assert.equal(harness.validationCalls, 0);
  assert.deepEqual(
    harness.workerInputs.map((input) => input.model.model),
    [PRIMARY_MODEL.model, FALLBACK_MODEL.model],
  );
  assert.equal(harness.evidenceRecords.at(-1)?.eventType, 'blocked');
});

test('routing failure blocks before repository mutation', async () => {
  const harness = createHarness({ routingFailure: true });

  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'blocked');
  assert.equal(
    result.state.blockerReason,
    'Engineering runner failed closed during model routing.',
  );
  assert.equal(harness.routingCalls, 1);
  assert.equal(harness.workspacePrepareCalls, 0);
  assert.deepEqual(harness.authorizationActions, []);
  assert.equal(harness.evidenceRecords.at(-1)?.eventType, 'blocked');
});

test('ordinary worker failure does not silently activate fallback', async () => {
  const harness = createHarness({ workerErrorModel: PRIMARY_MODEL.model });

  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'blocked');
  assert.equal(
    result.state.blockerReason,
    'Engineering runner failed closed during worker implementation.',
  );
  assert.deepEqual(
    harness.workerInputs.map((input) => input.model.model),
    [PRIMARY_MODEL.model],
  );
  assert.equal(
    harness.evidenceRecords.some((record) => record.eventType === 'model_fallback'),
    false,
  );
});

test('durable evidence failure blocks before subsequent repository mutation', async () => {
  const harness = createHarness({ evidenceFailureEvent: 'model_selected' });

  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'blocked');
  assert.equal(
    result.state.blockerReason,
    'Engineering runner failed closed during model routing.',
  );
  assert.equal(harness.workspacePrepareCalls, 0);
  assert.deepEqual(harness.authorizationActions, []);
  assert.equal(harness.evidenceRecords.length, 1);
  assert.equal(harness.evidenceRecords[0]?.sequence, 1);
  assert.equal(harness.evidenceRecords[0]?.eventType, 'blocked');
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
  assert.deepEqual(harness.reviewHeads, [HEAD_TWO]);
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
  assert.deepEqual(harness.reviewHeads, [HEAD_ONE, HEAD_TWO]);
  assert.deepEqual(harness.pushedHeads, [HEAD_ONE, HEAD_TWO]);
  assert.deepEqual(harness.draftHeads, [HEAD_ONE, HEAD_TWO]);
  assert.deepEqual(harness.ciHeads, [HEAD_ONE, HEAD_TWO]);
  assert.deepEqual(result.state.pullRequest, {
    number: 11,
    headSha: HEAD_TWO,
    draft: true,
  });
});

test('workspace HEAD change during validation blocks before review or push', async () => {
  const harness = createHarness({ validationHeadMutation: OTHER_HEAD });

  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'blocked');
  assert.equal(result.state.blockerReason, 'Engineering workspace HEAD changed during validation.');
  assert.deepEqual(harness.reviewHeads, []);
  assert.deepEqual(harness.pushedHeads, []);
  assert.deepEqual(harness.draftHeads, []);
  assert.deepEqual(harness.ciHeads, []);
});

test('workspace HEAD change during review blocks before push', async () => {
  const harness = createHarness({ reviewHeadMutation: OTHER_HEAD });

  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'blocked');
  assert.equal(
    result.state.blockerReason,
    'Engineering workspace HEAD changed during independent review.',
  );
  assert.deepEqual(harness.reviewHeads, [HEAD_ONE]);
  assert.deepEqual(harness.pushedHeads, []);
  assert.deepEqual(harness.draftHeads, []);
  assert.deepEqual(harness.ciHeads, []);
});

test('validation authorization denial fails closed before validation runs', async () => {
  const harness = createHarness({ denyAction: 'run_validation' });

  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'blocked');
  assert.equal(result.state.decisionState, 'BLOCKED');
  assert.equal(result.state.blockerReason, 'Engineering runner failed closed during validation.');
  assert.equal(harness.validationCalls, 0);
  assert.deepEqual(harness.authorizationActions, ['create_feature_branch', 'run_validation']);
  assert.deepEqual(harness.reviewHeads, []);
  assert.deepEqual(harness.pushedHeads, []);
  assert.deepEqual(harness.draftHeads, []);
  assert.deepEqual(harness.ciHeads, []);
});

test('authorization denial fails closed before the denied mutation', async () => {
  const harness = createHarness({ denyAction: 'push_feature_branch' });

  const result = await harness.runner.run(envelope());

  assert.equal(result.state.status, 'blocked');
  assert.equal(result.state.decisionState, 'BLOCKED');
  assert.equal(
    result.state.blockerReason,
    'Engineering runner failed closed during feature branch push.',
  );
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

test('untrusted review text is not copied into canonical blocker or evidence state', async () => {
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
  assert.equal(
    JSON.stringify(harness.evidenceRecords).includes('token=should-not-enter-run-state'),
    false,
  );
  assert.deepEqual(harness.pushedHeads, []);
});
