import { randomUUID } from 'node:crypto';

import type {
  CandidateDecisionTrace,
  CapabilityRecord,
  CapabilityRegistry,
  DecisionTraceStore,
  ModelExchangeOptions,
  ModelIdentity,
  RoutingDecision,
  RoutingDecisionTrace,
  RoutingRequest,
} from './contracts.ts';
import { evaluateHardGates } from './hard-gates.ts';
import {
  ModelExchangeContractError,
  parseCapabilityRecord,
  parseRoutingDecisionTrace,
  parseRoutingRequest,
} from './validation.ts';

export class NoEligibleCandidateError extends Error {
  readonly request_id: string;
  readonly reason: 'NO_ELIGIBLE_CANDIDATE' | 'INSUFFICIENT_REDUNDANCY';

  constructor(requestId: string, reason: 'NO_ELIGIBLE_CANDIDATE' | 'INSUFFICIENT_REDUNDANCY') {
    super(
      reason === 'INSUFFICIENT_REDUNDANCY'
        ? 'Routing failed closed because fewer than two eligible candidates remain.'
        : 'Routing failed closed because no eligible candidate remains.',
    );
    this.name = 'NoEligibleCandidateError';
    this.request_id = requestId;
    this.reason = reason;
  }
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function compareIdentities(left: ModelIdentity, right: ModelIdentity): number {
  return (
    compareText(left.model_id, right.model_id) ||
    compareText(left.provider, right.provider) ||
    compareText(left.revision, right.revision)
  );
}

function compareCandidates(left: CandidateDecisionTrace, right: CandidateDecisionTrace): number {
  const leftScore = left.score;
  const rightScore = right.score;

  if (leftScore === null || rightScore === null) {
    throw new Error('Eligible candidate is missing a finite score.');
  }

  return rightScore - leftScore || compareIdentities(left.candidate, right.candidate);
}

function capabilityIdentityKey(capability: CapabilityRecord): string {
  return `${capability.model_id}\u0000${capability.provider}\u0000${capability.revision}`;
}

function whyThisModel(
  request: RoutingRequest,
  winner: CandidateDecisionTrace,
  fallbackCount: number,
): string {
  const identity = winner.candidate;
  const passedGates = winner.gates.map((result) => result.gate).join(', ');

  return [
    `Task class ${request.task_class} in ${request.mode} mode selected`,
    `${identity.model_id} (${identity.provider}, revision ${identity.revision}).`,
    `It passed hard gates ${passedGates} and has finite score ${String(winner.score)}.`,
    `It ranked above ${String(fallbackCount)} eligible fallback(s) by descending score,`,
    'then deterministic model_id, provider, and revision ordering.',
  ].join(' ');
}

export function createRoutingDecisionTrace(
  requestValue: unknown,
  capabilityValues: readonly unknown[],
  options: ModelExchangeOptions = {},
): RoutingDecisionTrace {
  const request = parseRoutingRequest(requestValue);
  const capabilities = capabilityValues.map((capability) => parseCapabilityRecord(capability));
  const capabilityKeys = new Set<string>();

  for (const capability of capabilities) {
    const key = capabilityIdentityKey(capability);

    if (capabilityKeys.has(key)) {
      throw new ModelExchangeContractError('CapabilityRegistry', 'duplicate_identity');
    }

    capabilityKeys.add(key);
  }

  capabilities.sort((left, right) =>
    compareIdentities(
      {
        model_id: left.model_id,
        provider: left.provider,
        revision: left.revision,
      },
      {
        model_id: right.model_id,
        provider: right.provider,
        revision: right.revision,
      },
    ),
  );

  const candidates = Object.freeze(
    capabilities.map((capability) => evaluateHardGates(capability, request)),
  );
  const eligible = candidates.filter((candidate) => candidate.eligible).sort(compareCandidates);

  if (eligible.length === 0) {
    throw new NoEligibleCandidateError(request.request_id, 'NO_ELIGIBLE_CANDIDATE');
  }

  if ((request.mode === 'REDUNDANT' || request.mode === 'CRITICAL') && eligible.length < 2) {
    throw new NoEligibleCandidateError(request.request_id, 'INSUFFICIENT_REDUNDANCY');
  }

  const winner = eligible[0];

  if (winner === undefined || winner.score === null) {
    throw new NoEligibleCandidateError(request.request_id, 'NO_ELIGIBLE_CANDIDATE');
  }

  const fallbacks = Object.freeze(eligible.slice(1).map((candidate) => candidate.candidate));
  const createDecisionId = options.createDecisionId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  return parseRoutingDecisionTrace({
    decision_id: createDecisionId(),
    request_id: request.request_id,
    created_at: now().toISOString(),
    request,
    task_class: request.task_class,
    mode: request.mode,
    winner: winner.candidate,
    fallbacks,
    why_this_model: whyThisModel(request, winner, fallbacks.length),
    confidence: null,
    selected_score: winner.score,
    candidates,
  });
}

function decisionFromTrace(trace: RoutingDecisionTrace): RoutingDecision {
  return Object.freeze({
    decision_id: trace.decision_id,
    request_id: trace.request_id,
    winner: trace.winner,
    fallbacks: trace.fallbacks,
    why_this_model: trace.why_this_model,
    confidence: trace.confidence,
  });
}

export class ModelExchange {
  readonly #registry: CapabilityRegistry;
  readonly #traceStore: DecisionTraceStore;
  readonly #options: ModelExchangeOptions;

  constructor(
    registry: CapabilityRegistry,
    traceStore: DecisionTraceStore,
    options: ModelExchangeOptions = {},
  ) {
    this.#registry = registry;
    this.#traceStore = traceStore;
    this.#options = options;
  }

  async route(request: unknown): Promise<RoutingDecision> {
    const capabilities = await this.#registry.list();
    const trace = createRoutingDecisionTrace(request, capabilities, this.#options);
    const persistedTrace = parseRoutingDecisionTrace(await this.#traceStore.record(trace));

    return decisionFromTrace(persistedTrace);
  }
}
