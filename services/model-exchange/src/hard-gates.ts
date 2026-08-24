import type {
  CandidateDecisionTrace,
  CapabilityRecord,
  HardGateResult,
  ModelIdentity,
  RoutingRequest,
} from './contracts.ts';
import { evaluateLifecycle } from './lifecycle.ts';

export function toModelIdentity(capability: CapabilityRecord): ModelIdentity {
  return Object.freeze({
    model_id: capability.model_id,
    provider: capability.provider,
    revision: capability.revision,
  });
}

function gate(gateName: HardGateResult['gate'], passed: boolean, reason: string): HardGateResult {
  return Object.freeze({ gate: gateName, passed, reason });
}

export function evaluateHardGates(
  capability: CapabilityRecord,
  request: RoutingRequest,
): CandidateDecisionTrace {
  const lifecycle = evaluateLifecycle(capability.lifecycle, request.mode);
  const score = capability.scores[request.mode];
  const scoreAvailable = typeof score === 'number' && Number.isFinite(score);
  const providerSatisfied =
    request.requirements.provider === undefined ||
    request.requirements.provider === capability.provider;
  const revisionSatisfied =
    request.requirements.revision === undefined ||
    request.requirements.revision === capability.revision;
  const requirementsSatisfied = providerSatisfied && revisionSatisfied;

  const gates = Object.freeze([
    gate('CAPABILITY_VALID', true, 'CapabilityRecord passed runtime validation.'),
    gate(
      'TASK_CLASS_SUPPORTED',
      capability.task_classes.includes(request.task_class),
      capability.task_classes.includes(request.task_class)
        ? `Candidate supports task class ${request.task_class}.`
        : `Candidate does not support task class ${request.task_class}.`,
    ),
    gate('LIFECYCLE_ALLOWED', lifecycle.allowed, lifecycle.reason),
    gate(
      'SCORE_AVAILABLE',
      scoreAvailable,
      scoreAvailable
        ? `Candidate has a finite ${request.mode} score.`
        : `Candidate has no finite ${request.mode} score.`,
    ),
    gate(
      'REQUIREMENTS_SATISFIED',
      requirementsSatisfied,
      requirementsSatisfied
        ? 'All validated provider and revision requirements are satisfied.'
        : 'At least one validated provider or revision requirement is not satisfied.',
    ),
  ] satisfies readonly HardGateResult[]);

  const excludedReasons = gates
    .filter((result) => !result.passed)
    .map((result) => `${result.gate}: ${result.reason}`);

  return Object.freeze({
    candidate: toModelIdentity(capability),
    eligible: excludedReasons.length === 0,
    score: scoreAvailable ? score : null,
    gates,
    excluded_reasons: Object.freeze(excludedReasons),
  });
}
