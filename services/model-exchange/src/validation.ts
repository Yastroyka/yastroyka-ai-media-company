import {
  HARD_GATE_CODES,
  MODEL_LIFECYCLES,
  ROUTING_MODES,
  type CandidateDecisionTrace,
  type CapabilityRecord,
  type HardGateCode,
  type HardGateResult,
  type ModelIdentity,
  type ModelLifecycle,
  type RoutingDecisionTrace,
  type RoutingMode,
  type RoutingRequest,
  type RoutingRequirements,
} from './contracts.ts';

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_REASON_LENGTH = 512;

export class ModelExchangeContractError extends Error {
  readonly contract: string;
  readonly field: string;

  constructor(contract: string, field: string) {
    super(`${contract} violates the Model Exchange contract at ${field}.`);
    this.name = 'ModelExchangeContractError';
    this.contract = contract;
    this.field = field;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, contract: string, field = '$'): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ModelExchangeContractError(contract, field);
  }

  return value;
}

function requireKnownFields(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  contract: string,
  field = '$',
): void {
  const unknown = Object.keys(record).find((key) => !allowed.includes(key));

  if (unknown !== undefined) {
    throw new ModelExchangeContractError(contract, `${field}.${unknown}`);
  }
}

function requireString(
  record: Readonly<Record<string, unknown>>,
  field: string,
  contract: string,
  maximumLength = MAX_IDENTIFIER_LENGTH,
): string {
  const value = record[field];

  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
    throw new ModelExchangeContractError(contract, field);
  }

  return value;
}

function requireDateTime(
  record: Readonly<Record<string, unknown>>,
  field: string,
  contract: string,
): string {
  const value = requireString(record, field, contract);

  if (!Number.isFinite(Date.parse(value))) {
    throw new ModelExchangeContractError(contract, field);
  }

  return value;
}

function parseIdentity(value: unknown, contract: string, field: string): ModelIdentity {
  const identity = requireRecord(value, contract, field);
  requireKnownFields(identity, ['model_id', 'provider', 'revision'], contract, field);

  return Object.freeze({
    model_id: requireString(identity, 'model_id', contract),
    provider: requireString(identity, 'provider', contract),
    revision: requireString(identity, 'revision', contract),
  });
}

function parseRoutingRequirements(value: unknown): RoutingRequirements {
  const requirements = requireRecord(value, 'RoutingRequest', 'requirements');
  requireKnownFields(requirements, ['provider', 'revision'], 'RoutingRequest', 'requirements');

  const provider = requirements.provider;
  const revision = requirements.revision;

  if (
    provider !== undefined &&
    (typeof provider !== 'string' ||
      provider.length === 0 ||
      provider.length > MAX_IDENTIFIER_LENGTH)
  ) {
    throw new ModelExchangeContractError('RoutingRequest', 'requirements.provider');
  }

  if (
    revision !== undefined &&
    (typeof revision !== 'string' ||
      revision.length === 0 ||
      revision.length > MAX_IDENTIFIER_LENGTH)
  ) {
    throw new ModelExchangeContractError('RoutingRequest', 'requirements.revision');
  }

  return Object.freeze({
    ...(provider !== undefined ? { provider } : {}),
    ...(revision !== undefined ? { revision } : {}),
  });
}

function parseScores(value: unknown): CapabilityRecord['scores'] {
  if (value === undefined) {
    return Object.freeze({});
  }

  const rawScores = requireRecord(value, 'CapabilityRecord', 'scores');
  const sanitizedScores: Partial<Record<RoutingMode, number | null>> = {};

  for (const mode of ROUTING_MODES) {
    const score = rawScores[mode];

    if (score === undefined) {
      continue;
    }

    sanitizedScores[mode] = typeof score === 'number' && Number.isFinite(score) ? score : null;
  }

  return Object.freeze(sanitizedScores);
}

export function parseCapabilityRecord(value: unknown): CapabilityRecord {
  const record = requireRecord(value, 'CapabilityRecord');
  requireKnownFields(
    record,
    ['model_id', 'provider', 'revision', 'task_classes', 'scores', 'lifecycle', 'verified_at'],
    'CapabilityRecord',
  );

  const taskClasses = record.task_classes;
  const lifecycle = record.lifecycle;

  if (
    !Array.isArray(taskClasses) ||
    !taskClasses.every(
      (taskClass) =>
        typeof taskClass === 'string' &&
        taskClass.length > 0 &&
        taskClass.length <= MAX_IDENTIFIER_LENGTH,
    ) ||
    new Set(taskClasses).size !== taskClasses.length
  ) {
    throw new ModelExchangeContractError('CapabilityRecord', 'task_classes');
  }

  if (typeof lifecycle !== 'string' || !MODEL_LIFECYCLES.includes(lifecycle as ModelLifecycle)) {
    throw new ModelExchangeContractError('CapabilityRecord', 'lifecycle');
  }

  return Object.freeze({
    model_id: requireString(record, 'model_id', 'CapabilityRecord'),
    provider: requireString(record, 'provider', 'CapabilityRecord'),
    revision: requireString(record, 'revision', 'CapabilityRecord'),
    task_classes: Object.freeze([...taskClasses]) as readonly string[],
    scores: parseScores(record.scores),
    lifecycle: lifecycle as ModelLifecycle,
    verified_at: requireDateTime(record, 'verified_at', 'CapabilityRecord'),
  });
}

export function parseRoutingRequest(value: unknown): RoutingRequest {
  const record = requireRecord(value, 'RoutingRequest');
  requireKnownFields(
    record,
    ['request_id', 'task_class', 'mode', 'requirements'],
    'RoutingRequest',
  );

  const mode = record.mode;

  if (typeof mode !== 'string' || !ROUTING_MODES.includes(mode as RoutingMode)) {
    throw new ModelExchangeContractError('RoutingRequest', 'mode');
  }

  return Object.freeze({
    request_id: requireString(record, 'request_id', 'RoutingRequest'),
    task_class: requireString(record, 'task_class', 'RoutingRequest'),
    mode: mode as RoutingMode,
    requirements: parseRoutingRequirements(record.requirements),
  });
}

function parseHardGateResult(value: unknown, index: number): HardGateResult {
  const contract = 'RoutingDecisionTrace';
  const field = `candidates.gates[${index}]`;
  const record = requireRecord(value, contract, field);
  requireKnownFields(record, ['gate', 'passed', 'reason'], contract, field);
  const gate = record.gate;

  if (typeof gate !== 'string' || !HARD_GATE_CODES.includes(gate as HardGateCode)) {
    throw new ModelExchangeContractError(contract, `${field}.gate`);
  }

  if (typeof record.passed !== 'boolean') {
    throw new ModelExchangeContractError(contract, `${field}.passed`);
  }

  return Object.freeze({
    gate: gate as HardGateCode,
    passed: record.passed,
    reason: requireString(record, 'reason', contract, MAX_REASON_LENGTH),
  });
}

function parseCandidateTrace(value: unknown, index: number): CandidateDecisionTrace {
  const contract = 'RoutingDecisionTrace';
  const field = `candidates[${index}]`;
  const record = requireRecord(value, contract, field);
  requireKnownFields(
    record,
    ['candidate', 'eligible', 'score', 'gates', 'excluded_reasons'],
    contract,
    field,
  );

  if (typeof record.eligible !== 'boolean') {
    throw new ModelExchangeContractError(contract, `${field}.eligible`);
  }

  if (
    record.score !== null &&
    (typeof record.score !== 'number' || !Number.isFinite(record.score))
  ) {
    throw new ModelExchangeContractError(contract, `${field}.score`);
  }

  if (!Array.isArray(record.gates)) {
    throw new ModelExchangeContractError(contract, `${field}.gates`);
  }

  if (
    !Array.isArray(record.excluded_reasons) ||
    !record.excluded_reasons.every(
      (reason) =>
        typeof reason === 'string' && reason.length > 0 && reason.length <= MAX_REASON_LENGTH,
    )
  ) {
    throw new ModelExchangeContractError(contract, `${field}.excluded_reasons`);
  }

  return Object.freeze({
    candidate: parseIdentity(record.candidate, contract, `${field}.candidate`),
    eligible: record.eligible,
    score: record.score as number | null,
    gates: Object.freeze(
      record.gates.map((gate, gateIndex) => parseHardGateResult(gate, gateIndex)),
    ),
    excluded_reasons: Object.freeze([...record.excluded_reasons]) as readonly string[],
  });
}

export function parseRoutingDecisionTrace(value: unknown): RoutingDecisionTrace {
  const contract = 'RoutingDecisionTrace';
  const record = requireRecord(value, contract);
  requireKnownFields(
    record,
    [
      'decision_id',
      'request_id',
      'created_at',
      'request',
      'task_class',
      'mode',
      'winner',
      'fallbacks',
      'why_this_model',
      'confidence',
      'selected_score',
      'candidates',
    ],
    contract,
  );

  const request = parseRoutingRequest(record.request);
  const mode = record.mode;
  const fallbacks = record.fallbacks;
  const candidates = record.candidates;

  if (typeof mode !== 'string' || !ROUTING_MODES.includes(mode as RoutingMode)) {
    throw new ModelExchangeContractError(contract, 'mode');
  }

  if (!Array.isArray(fallbacks)) {
    throw new ModelExchangeContractError(contract, 'fallbacks');
  }

  if (!Array.isArray(candidates)) {
    throw new ModelExchangeContractError(contract, 'candidates');
  }

  if (
    record.confidence !== null &&
    (typeof record.confidence !== 'number' ||
      !Number.isFinite(record.confidence) ||
      record.confidence < 0 ||
      record.confidence > 1)
  ) {
    throw new ModelExchangeContractError(contract, 'confidence');
  }

  if (typeof record.selected_score !== 'number' || !Number.isFinite(record.selected_score)) {
    throw new ModelExchangeContractError(contract, 'selected_score');
  }

  const requestId = requireString(record, 'request_id', contract);
  const taskClass = requireString(record, 'task_class', contract);

  if (
    requestId !== request.request_id ||
    taskClass !== request.task_class ||
    mode !== request.mode
  ) {
    throw new ModelExchangeContractError(contract, 'request_consistency');
  }

  return Object.freeze({
    decision_id: requireString(record, 'decision_id', contract),
    request_id: requestId,
    created_at: requireDateTime(record, 'created_at', contract),
    request,
    task_class: taskClass,
    mode: mode as RoutingMode,
    winner: parseIdentity(record.winner, contract, 'winner'),
    fallbacks: Object.freeze(
      fallbacks.map((fallback, index) => parseIdentity(fallback, contract, `fallbacks[${index}]`)),
    ),
    why_this_model: requireString(record, 'why_this_model', contract, 4096),
    confidence: record.confidence as number | null,
    selected_score: record.selected_score,
    candidates: Object.freeze(
      candidates.map((candidate, index) => parseCandidateTrace(candidate, index)),
    ),
  });
}
