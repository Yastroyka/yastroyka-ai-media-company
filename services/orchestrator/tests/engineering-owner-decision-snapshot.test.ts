import assert from 'node:assert/strict';
import test from 'node:test';

import { EngineeringRunStateMachine } from '../src/engineering-run.ts';

const BASE_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HEAD_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

async function loadSnapshotModule() {
  return import('../src/engineering-owner-decision-snapshot.ts').catch(() => null);
}

function readyState() {
  const machine = new EngineeringRunStateMachine({
    runId: 'run-task-026-001',
    taskId: 'TASK-026',
    objective: 'Expose a stable owner decision snapshot for the autonomous engineering loop.',
    baseSha: BASE_SHA,
    branch: 'feat/task-026-autonomous-engineering-loop',
    riskClass: 'R2',
    maxAttempts: 2,
    requiredChecks: ['Quality'],
    modelSelection: null,
  });

  machine.apply({
    type: 'MODEL_SELECTED',
    selection: {
      provider: 'openai',
      model: 'codex',
      whyThisModel: 'Repository engineering task.',
      fallbackProviders: ['qwen'],
    },
  });
  machine.apply({ type: 'START' });
  machine.apply({ type: 'IMPLEMENTATION_READY' });
  machine.apply({
    type: 'VALIDATION_PASSED',
    checks: [{ name: 'Quality', conclusion: 'passed' }],
  });
  machine.apply({ type: 'REVIEW_PASSED' });
  machine.apply({ type: 'DRAFT_PR_PUBLISHED', prNumber: 37, headSha: HEAD_SHA });
  machine.apply({ type: 'CI_PASSED', headSha: HEAD_SHA });

  return machine.state;
}

test('TASK-026 projects a decision-ready engineering run into one exact owner-facing contract', async () => {
  const snapshotModule = await loadSnapshotModule();
  assert.notEqual(snapshotModule, null, 'TASK-026 owner decision snapshot module must exist');

  const snapshot = snapshotModule!.createEngineeringOwnerDecisionSnapshot(
    readyState(),
    '2026-09-10T00:00:00.000Z',
  );

  assert.deepEqual(snapshot, {
    schemaVersion: 'engineering-owner-decision/v1',
    observedAt: '2026-09-10T00:00:00.000Z',
    run: {
      runId: 'run-task-026-001',
      taskId: 'TASK-026',
      status: 'ready_for_owner_decision',
      decisionState: 'READY_FOR_OWNER_DECISION',
      riskClass: 'R2',
      attempt: 1,
      maxAttempts: 2,
      baseSha: BASE_SHA,
      branch: 'feat/task-026-autonomous-engineering-loop',
    },
    modelSelection: {
      provider: 'openai',
      model: 'codex',
      whyThisModel: 'Repository engineering task.',
      fallbackProviders: ['qwen'],
    },
    validation: {
      requiredChecks: ['Quality'],
      evidence: [{ name: 'Quality', conclusion: 'passed' }],
    },
    pullRequest: {
      number: 37,
      headSha: HEAD_SHA,
      draft: true,
    },
    blockerReason: null,
  });
});
