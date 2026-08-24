import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InMemoryCapabilityRegistry,
  ModelExchange,
  ModelExchangeContractError,
  NoEligibleCandidateError,
  createRoutingDecisionTrace,
  evaluateHardGates,
  parseCapabilityRecord,
  parseRoutingRequest,
  type DecisionTraceStore,
  type RoutingDecisionTrace,
} from '../src/index.ts';

const VERIFIED_AT = '2026-08-24T08:00:00.000Z';
const CREATED_AT = '2026-08-24T09:00:00.000Z';

function capability(
  modelId: string,
  taskClass: string,
  score: number | null,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    model_id: modelId,
    provider: `provider-${modelId}`,
    revision: 'r1',
    task_classes: [taskClass],
    scores: {
      MAX_QUALITY: score,
      BEST_VALUE: score,
      FAST: score,
      BULK: score,
      EXPERIMENT: score,
      REDUNDANT: score,
      CRITICAL: score,
    },
    lifecycle: 'PRODUCTION',
    verified_at: VERIFIED_AT,
    ...overrides,
  };
}

function request(
  requestId: string,
  taskClass: string,
  mode = 'MAX_QUALITY',
  requirements: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    request_id: requestId,
    task_class: taskClass,
    mode,
    requirements,
  };
}

class RecordingTraceStore implements DecisionTraceStore {
  readonly traces: RoutingDecisionTrace[] = [];

  async record(trace: RoutingDecisionTrace): Promise<RoutingDecisionTrace> {
    const copy = structuredClone(trace);
    this.traces.push(copy);
    return copy;
  }
}

function fixedOptions(decisionId = '00000000-0000-4000-8000-000000000007') {
  return {
    createDecisionId: () => decisionId,
    now: () => new Date(CREATED_AT),
  };
}

const acceptanceCapabilities = [
  capability('text-a', 'TEXT_GENERATION', 0.91),
  capability('text-b', 'TEXT_GENERATION', 0.82),
  capability('image-a', 'IMAGE_GENERATION', 0.89),
  capability('image-b', 'IMAGE_GENERATION', 0.78),
  capability('summary-a', 'SUMMARIZATION', 0.94),
  capability('summary-b', 'SUMMARIZATION', 0.86),
];

test('routes three task classes with at least two eligible candidates each', async () => {
  const cases = [
    ['TEXT_GENERATION', 'text-a', 'text-b'],
    ['IMAGE_GENERATION', 'image-a', 'image-b'],
    ['SUMMARIZATION', 'summary-a', 'summary-b'],
  ] as const;

  for (const [taskClass, expectedWinner, expectedFallback] of cases) {
    const store = new RecordingTraceStore();
    const exchange = new ModelExchange(
      new InMemoryCapabilityRegistry(acceptanceCapabilities),
      store,
      fixedOptions(),
    );
    const decision = await exchange.route(request(`request-${taskClass}`, taskClass));

    assert.equal(decision.winner.model_id, expectedWinner);
    assert.deepEqual(
      decision.fallbacks.map((fallback) => fallback.model_id),
      [expectedFallback],
    );
    assert.equal(store.traces[0]?.candidates.filter((candidate) => candidate.eligible).length, 2);
  }
});

test('winner and fallback ordering are deterministic regardless of registry order', () => {
  const candidates = [
    capability('model-z', 'TEXT_GENERATION', 0.8),
    capability('model-b', 'TEXT_GENERATION', 0.9),
    capability('model-a', 'TEXT_GENERATION', 0.9),
  ];
  const forward = createRoutingDecisionTrace(
    request('deterministic-forward', 'TEXT_GENERATION'),
    candidates,
    fixedOptions(),
  );
  const reversed = createRoutingDecisionTrace(
    request('deterministic-reversed', 'TEXT_GENERATION'),
    [...candidates].reverse(),
    fixedOptions(),
  );

  assert.equal(forward.winner.model_id, 'model-a');
  assert.deepEqual(
    forward.fallbacks.map((fallback) => fallback.model_id),
    ['model-b', 'model-z'],
  );
  assert.deepEqual(forward.winner, reversed.winner);
  assert.deepEqual(forward.fallbacks, reversed.fallbacks);
});

test('hard gates exclude wrong task class and unmet supported requirements', () => {
  const candidate = parseCapabilityRecord(capability('candidate-a', 'IMAGE_GENERATION', 0.9));
  const wrongTask = evaluateHardGates(
    candidate,
    parseRoutingRequest(request('wrong-task', 'TEXT_GENERATION')),
  );
  const wrongProvider = evaluateHardGates(
    candidate,
    parseRoutingRequest(
      request('wrong-provider', 'IMAGE_GENERATION', 'MAX_QUALITY', {
        provider: 'required-provider',
      }),
    ),
  );

  assert.equal(wrongTask.eligible, false);
  assert.match(wrongTask.excluded_reasons.join(' '), /TASK_CLASS_SUPPORTED/u);
  assert.equal(wrongProvider.eligible, false);
  assert.match(wrongProvider.excluded_reasons.join(' '), /REQUIREMENTS_SATISFIED/u);
});

test('QUARANTINE, SUSPENDED, and REVOKED are never winners or fallbacks', () => {
  const trace = createRoutingDecisionTrace(
    request('blocked-lifecycles', 'TEXT_GENERATION'),
    [
      capability('production-a', 'TEXT_GENERATION', 0.5),
      capability('quarantined-a', 'TEXT_GENERATION', 1, { lifecycle: 'QUARANTINE' }),
      capability('suspended-a', 'TEXT_GENERATION', 1, { lifecycle: 'SUSPENDED' }),
      capability('revoked-a', 'TEXT_GENERATION', 1, { lifecycle: 'REVOKED' }),
    ],
    fixedOptions(),
  );

  assert.equal(trace.winner.model_id, 'production-a');
  assert.deepEqual(trace.fallbacks, []);
  assert.equal(trace.candidates.filter((candidate) => !candidate.eligible).length, 3);
});

test('CANARY is blocked outside EXPERIMENT and allowed only in EXPERIMENT', () => {
  const candidates = [
    capability('production-a', 'TEXT_GENERATION', 0.5),
    capability('canary-a', 'TEXT_GENERATION', 1, { lifecycle: 'CANARY' }),
  ];
  const normal = createRoutingDecisionTrace(
    request('normal-mode', 'TEXT_GENERATION'),
    candidates,
    fixedOptions(),
  );
  const experiment = createRoutingDecisionTrace(
    request('experiment-mode', 'TEXT_GENERATION', 'EXPERIMENT'),
    candidates,
    fixedOptions(),
  );

  assert.equal(normal.winner.model_id, 'production-a');
  assert.equal(normal.fallbacks.length, 0);
  assert.equal(experiment.winner.model_id, 'canary-a');
  assert.deepEqual(
    experiment.fallbacks.map((fallback) => fallback.model_id),
    ['production-a'],
  );
});

test('missing and invalid requested scores are excluded before ranking', () => {
  const trace = createRoutingDecisionTrace(
    request('invalid-score', 'TEXT_GENERATION'),
    [
      capability('valid-a', 'TEXT_GENERATION', 0.4),
      capability('missing-a', 'TEXT_GENERATION', null, { scores: {} }),
      capability('invalid-a', 'TEXT_GENERATION', null, {
        scores: { MAX_QUALITY: 'not-a-number' },
      }),
    ],
    fixedOptions(),
  );

  assert.equal(trace.winner.model_id, 'valid-a');
  assert.equal(trace.fallbacks.length, 0);
  assert.equal(
    trace.candidates.filter((candidate) =>
      candidate.excluded_reasons.some((reason) => reason.startsWith('SCORE_AVAILABLE')),
    ).length,
    2,
  );
});

test('malformed CapabilityRecord and RoutingRequest payloads fail closed', () => {
  assert.throws(
    () => parseCapabilityRecord({ ...capability('bad-a', 'TEXT_GENERATION', 1), provider: 7 }),
    ModelExchangeContractError,
  );
  assert.throws(
    () => parseRoutingRequest({ ...request('bad-request', 'TEXT_GENERATION'), mode: 'AUTO' }),
    ModelExchangeContractError,
  );
  assert.throws(
    () =>
      parseRoutingRequest(
        request('unknown-requirement', 'TEXT_GENERATION', 'MAX_QUALITY', {
          latency_magic: true,
        }),
      ),
    ModelExchangeContractError,
  );
});

test('no eligible candidate fails closed', () => {
  assert.throws(
    () =>
      createRoutingDecisionTrace(
        request('no-eligible', 'TEXT_GENERATION'),
        [capability('image-only', 'IMAGE_GENERATION', 1)],
        fixedOptions(),
      ),
    (error: unknown) => {
      assert.ok(error instanceof NoEligibleCandidateError);
      assert.equal(error.reason, 'NO_ELIGIBLE_CANDIDATE');
      return true;
    },
  );
});

test('REDUNDANT and CRITICAL fail closed without two eligible candidates', () => {
  for (const mode of ['REDUNDANT', 'CRITICAL']) {
    assert.throws(
      () =>
        createRoutingDecisionTrace(
          request(`insufficient-${mode}`, 'TEXT_GENERATION', mode),
          [capability('only-a', 'TEXT_GENERATION', 1)],
          fixedOptions(),
        ),
      (error: unknown) => {
        assert.ok(error instanceof NoEligibleCandidateError);
        assert.equal(error.reason, 'INSUFFICIENT_REDUNDANCY');
        return true;
      },
    );
  }
});

test('external winner override cannot enter the routing path', async () => {
  const store = new RecordingTraceStore();
  const exchange = new ModelExchange(
    new InMemoryCapabilityRegistry(acceptanceCapabilities),
    store,
    fixedOptions(),
  );

  await assert.rejects(
    exchange.route({
      ...request('override-attempt', 'TEXT_GENERATION'),
      winner_override: { model_id: 'revoked-model' },
    }),
    ModelExchangeContractError,
  );
  assert.equal(store.traces.length, 0);
});

test('WHY THIS MODEL is non-empty, traceable, and excludes raw unknown score payload', () => {
  const secretMarker = 'must-not-enter-trace';
  const trace = createRoutingDecisionTrace(
    request('why-model', 'TEXT_GENERATION'),
    [
      capability('winner-a', 'TEXT_GENERATION', 0.9, {
        scores: { MAX_QUALITY: 0.9, provider_secret: secretMarker },
      }),
      capability('fallback-a', 'TEXT_GENERATION', 0.8),
    ],
    fixedOptions(),
  );
  const serialized = JSON.stringify(trace);

  assert.ok(trace.why_this_model.length > 0);
  assert.match(trace.why_this_model, /TEXT_GENERATION/u);
  assert.match(trace.why_this_model, /MAX_QUALITY/u);
  assert.match(trace.why_this_model, /SCORE_AVAILABLE/u);
  assert.match(trace.why_this_model, /0\.9/u);
  assert.match(trace.why_this_model, /fallback/u);
  assert.equal(serialized.includes(secretMarker), false);
  assert.equal(serialized.includes('provider_secret'), false);
});

test('a persistence failure prevents an unpersisted routing decision from being returned', async () => {
  const failingStore: DecisionTraceStore = {
    async record(): Promise<RoutingDecisionTrace> {
      throw new Error('persistence unavailable');
    },
  };
  const exchange = new ModelExchange(
    new InMemoryCapabilityRegistry(acceptanceCapabilities),
    failingStore,
    fixedOptions(),
  );

  await assert.rejects(
    exchange.route(request('persistence-failure', 'TEXT_GENERATION')),
    /persistence unavailable/u,
  );
});
