import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EngineeringPolicyDeniedError,
  EngineeringRunStateMachine,
  EngineeringRunTransitionError,
  assertAutonomousEngineeringActionAllowed,
  type AutonomousEngineeringAction,
  type EngineeringTaskEnvelope,
} from '../src/index.ts';

const BASE_SHA = 'c2bf1610a3f9fd1aeb540023cd798a25f7dd9ad0';
const HEAD_SHA = '1111111111111111111111111111111111111111';
const OTHER_HEAD_SHA = '2222222222222222222222222222222222222222';

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
  machine.apply({ type: 'VALIDATION_PASSED' });
  machine.apply({ type: 'REVIEW_PASSED' });
  machine.apply({ type: 'DRAFT_PR_PUBLISHED', prNumber: 10, headSha: HEAD_SHA });
}

test('engineering runs cannot target protected main', () => {
  assert.throws(
    () => new EngineeringRunStateMachine(envelope({ branch: 'main' })),
    /isolated feature branch/u,
  );
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
    () => machine.apply({ type: 'VALIDATION_PASSED' }),
    EngineeringRunTransitionError,
  );
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
