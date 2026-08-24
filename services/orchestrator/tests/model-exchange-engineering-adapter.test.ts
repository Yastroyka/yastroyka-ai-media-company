import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ModelExchangeEngineeringAdapter,
  type EngineeringTaskEnvelope,
  type ModelExchangeEngineeringClient,
  type ModelExchangeEngineeringDecision,
} from '../src/index.ts';

const BASE_SHA = 'a8cc2df1ce99e140f7d1e2ce093ff0a57bcde453';

function envelope(overrides: Partial<EngineeringTaskEnvelope> = {}): EngineeringTaskEnvelope {
  return {
    runId: 'routing-adapter-001',
    taskId: 'MILESTONE-03',
    objective: 'Route an engineering worker through Model Exchange.',
    baseSha: BASE_SHA,
    branch: 'milestone-03/model-routing-test',
    riskClass: 'R2',
    maxAttempts: 2,
    requiredChecks: ['quality'],
    modelSelection: null,
    ...overrides,
  };
}

const DECISION: ModelExchangeEngineeringDecision = {
  winner: {
    model_id: 'codex-engineering',
    provider: 'openai',
    revision: 'r1',
  },
  fallbacks: [
    {
      model_id: 'deepseek-coder',
      provider: 'deepseek',
      revision: 'r2',
    },
  ],
  why_this_model: 'Highest approved MAX_QUALITY score for engineering.',
};

function adapterHarness(decision: ModelExchangeEngineeringDecision = DECISION) {
  let request: unknown = null;
  const client: ModelExchangeEngineeringClient = {
    async route(value) {
      request = structuredClone(value);
      return decision;
    },
  };
  const adapter = new ModelExchangeEngineeringAdapter(client, {
    taskClass: 'ENGINEERING',
    modeByRisk: {
      R0: 'FAST',
      R1: 'BEST_VALUE',
      R2: 'MAX_QUALITY',
      R3: 'CRITICAL',
    },
  });

  return {
    adapter,
    get request() {
      return request;
    },
  };
}

test('adapter maps engineering envelope to Model Exchange request and preserves fallback identities', async () => {
  const harness = adapterHarness();

  const decision = await harness.adapter.route(envelope());

  assert.deepEqual(harness.request, {
    request_id: 'routing-adapter-001',
    task_class: 'ENGINEERING',
    mode: 'MAX_QUALITY',
    requirements: {},
  });
  assert.deepEqual(decision, {
    winner: {
      provider: 'openai',
      model: 'codex-engineering',
      revision: 'r1',
    },
    fallbacks: [
      {
        provider: 'deepseek',
        model: 'deepseek-coder',
        revision: 'r2',
      },
    ],
    whyThisModel: 'Highest approved MAX_QUALITY score for engineering.',
  });
});

test('routing mode remains explicit policy input rather than hidden adapter policy', async () => {
  const harness = adapterHarness();

  await harness.adapter.route(envelope({ riskClass: 'R3' }));

  assert.deepEqual(harness.request, {
    request_id: 'routing-adapter-001',
    task_class: 'ENGINEERING',
    mode: 'CRITICAL',
    requirements: {},
  });
});

test('adapter rejects duplicate Model Exchange candidate identities', async () => {
  const harness = adapterHarness({
    ...DECISION,
    fallbacks: [DECISION.winner],
  });

  await assert.rejects(() => harness.adapter.route(envelope()), /duplicate engineering candidate/u);
});

test('Model Exchange routing failure propagates to runner fail-closed boundary', async () => {
  const client: ModelExchangeEngineeringClient = {
    async route() {
      throw new Error('NO_ELIGIBLE_CANDIDATE');
    },
  };
  const adapter = new ModelExchangeEngineeringAdapter(client, {
    taskClass: 'ENGINEERING',
    modeByRisk: {
      R0: 'FAST',
      R1: 'BEST_VALUE',
      R2: 'MAX_QUALITY',
      R3: 'CRITICAL',
    },
  });

  await assert.rejects(() => adapter.route(envelope()), /NO_ELIGIBLE_CANDIDATE/u);
});
