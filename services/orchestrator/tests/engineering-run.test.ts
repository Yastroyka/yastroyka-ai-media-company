import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EngineeringPolicyDeniedError,
  EngineeringRunStateMachine,
  EngineeringRunTransitionError,
  assertAutonomousEngineeringActionAllowed,
  type AutonomousEngineeringAction,
  type EngineeringCheckEvidence,
  type EngineeringTaskEnvelope,
} from '../src/index.ts';

const BASE_SHA = 'a8cc2df1ce99e140f7d1e2ce093ff0a57bcde453';
const HEAD_SHA = '1111111111111111111111111111111111111111';
const OTHER_HEAD_SHA = '2222222222222222222222222222222222222222';

const PASSED_CHECKS: readonly EngineeringCheckEvidence[] = [
  { name: 'typecheck', conclusion: 'passed' },
  { name: 'test', conclusion: 'passed' },
  { name: 'quality', conclusion: 'passed' },
];

function envelope(overrides: Partial<EngineeringTaskEnvelope> = {}): EngineeringTaskEnvelope {
  return {
    runId: 'engineering-run-m03-001',
    taskId: 'MILESTONE-03',
    objective: 'Implement a bounded autonomous engineering run.',
    baseSha: BASE_SHA,
    branch: 'milestone-03/engineering-run-core',
    riskClass: 'R2',
    maxAttempts: 2,
    requiredChecks: ['typecheck', 'test', 'quality'],
    modelSelection: {
      provider: 'openai',
      model: 'codex-engineering',
      whyThisModel: 'Approved engineering capability for repository implementation.',
      fallbackProviders: ['approved-fallback'],
    },
    ...overrides,
  };
}

function moveToAwaitingCi(machine: EngineeringRunStateMachine): void {
  machine.apply({ type: 'START' });
  machine.apply({ type: 'IMPLEMENTATION_READY' });
  machine.apply({ type: 'VALIDATION_PASSED', checks: PASSED_CHECKS });
  machine.apply({ type: 'REVIEW_PASSED' });
  machine.apply({ type: 'DRAFT_PR_PUBLISHED', prNumber: 10, headSha: HEAD_SHA });
}

test('engineering runs cannot target protected main', () => {
  assert.throws(
    () => new EngineeringRunStateMachine(envelope({ branch: 'main' })),
    /isolated feature branch/u,
  );
});

test('run cannot START without a selected model', () => {
  const machine = new EngineeringRunStateMachine(envelope({ modelSelection: null }));

  assert.throws(() => machine.apply({ type: 'START' }), /cannot start without an approved model/u);
  assert.equal(machine.state.status, 'approved');
});

test('MODEL_SELECTED records routing decision before START', () => {
  const machine = new EngineeringRunStateMachine(envelope({ modelSelection: null }));

  const selected = machine.apply({
    type: 'MODEL_SELECTED',
    selection: {
      provider: 'openai',
      model: 'codex-engineering',
      whyThisModel: 'Selected by Model Exchange.',
      fallbackProviders: ['deepseek'],
    },
  });

  assert.deepEqual(selected.modelSelection, {
    provider: 'openai',
    model: 'codex-engineering',
    whyThisModel: 'Selected by Model Exchange.',
    fallbackProviders: ['deepseek'],
  });
  assert.equal(machine.apply({ type: 'START' }).status, 'executing');
});

test('validation retries are bounded and exhaustion becomes BLOCKED', () => {
  const machine = new EngineeringRunStateMachine(envelope({ maxAttempts: 2 }));

  assert.equal(machine.apply({ type: 'START' }).attempt, 1);
  machine.apply({ type: 'IMPLEMENTATION_READY' });

  const retry = machine.apply({ type: 'VALIDATION_FAILED', reason: 'unit test failed' });
  assert.equal(retry.status, 'executing');
  assert.equal(retry.attempt, 2);
  assert.equal(retry.decisionState, 'PENDING');

  machine.apply({ type: 'IMPLEMENTATION_READY' });
  const blocked = machine.apply({
    type: 'VALIDATION_FAILED',
    reason: 'unit test still failing',
  });

  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.decisionState, 'BLOCKED');
  assert.match(blocked.blockerReason ?? '', /retry budget exhausted/u);

  assert.throws(
    () => machine.apply({ type: 'VALIDATION_PASSED', checks: PASSED_CHECKS }),
    EngineeringRunTransitionError,
  );
});

test('validation PASS requires evidence for every required check', () => {
  const machine = new EngineeringRunStateMachine(envelope());
  machine.apply({ type: 'START' });
  machine.apply({ type: 'IMPLEMENTATION_READY' });

  assert.throws(
    () =>
      machine.apply({
        type: 'VALIDATION_PASSED',
        checks: [
          { name: 'typecheck', conclusion: 'passed' },
          { name: 'test', conclusion: 'passed' },
        ],
      }),
    /Required validation check has no evidence: quality/u,
  );

  assert.equal(machine.state.status, 'validating');
  assert.deepEqual(machine.state.validationEvidence, []);
});

test('failed or not-run required validation cannot be reported as PASS', () => {
  for (const conclusion of ['failed', 'not_run'] as const) {
    const machine = new EngineeringRunStateMachine(envelope());
    machine.apply({ type: 'START' });
    machine.apply({ type: 'IMPLEMENTATION_READY' });

    assert.throws(
      () =>
        machine.apply({
          type: 'VALIDATION_PASSED',
          checks: PASSED_CHECKS.map((check) =>
            check.name === 'quality' ? { ...check, conclusion } : check,
          ),
        }),
      /cannot be reported as PASS/u,
    );

    assert.equal(machine.state.status, 'validating');
  }
});

test('successful validation stores immutable evidence before review', () => {
  const machine = new EngineeringRunStateMachine(envelope());
  machine.apply({ type: 'START' });
  machine.apply({ type: 'IMPLEMENTATION_READY' });

  const state = machine.apply({ type: 'VALIDATION_PASSED', checks: PASSED_CHECKS });

  assert.equal(state.status, 'reviewing');
  assert.deepEqual(state.validationEvidence, PASSED_CHECKS);
});

test('CI evidence is bound to the exact Draft PR head SHA', () => {
  const machine = new EngineeringRunStateMachine(envelope());
  moveToAwaitingCi(machine);

  const blocked = machine.apply({ type: 'CI_PASSED', headSha: OTHER_HEAD_SHA });

  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.decisionState, 'BLOCKED');
  assert.match(blocked.blockerReason ?? '', /does not match Draft PR head/u);
});

test('successful exact-head CI reaches owner decision without leaving Draft state', () => {
  const machine = new EngineeringRunStateMachine(envelope());
  moveToAwaitingCi(machine);

  const ready = machine.apply({ type: 'CI_PASSED', headSha: HEAD_SHA });

  assert.equal(ready.status, 'ready_for_owner_decision');
  assert.equal(ready.decisionState, 'READY_FOR_OWNER_DECISION');
  assert.deepEqual(ready.pullRequest, {
    number: 10,
    headSha: HEAD_SHA,
    draft: true,
  });
  assert.deepEqual(ready.validationEvidence, PASSED_CHECKS);
});

test('autonomous policy allows reversible routine actions only', () => {
  const allowed: readonly AutonomousEngineeringAction[] = [
    'read_main',
    'create_feature_branch',
    'run_validation',
    'push_feature_branch',
    'create_or_update_draft_pr',
    'observe_ci',
  ];

  for (const action of allowed) {
    assert.doesNotThrow(() => assertAutonomousEngineeringActionAllowed(action));
  }
});

test('owner-only and dangerous actions fail closed', () => {
  const denied: readonly AutonomousEngineeringAction[] = [
    'direct_main_push',
    'force_push',
    'merge_protected_branch',
    'mark_ready_for_review',
    'read_secret',
    'destructive_command',
    'production_write',
    'permission_expansion',
  ];

  for (const action of denied) {
    assert.throws(
      () => assertAutonomousEngineeringActionAllowed(action),
      (error: unknown) => {
        assert.ok(error instanceof EngineeringPolicyDeniedError);
        assert.equal(error.action, action);
        return true;
      },
    );
  }
});
