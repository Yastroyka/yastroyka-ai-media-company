export {
  HARD_GATE_CODES,
  MODEL_LIFECYCLES,
  ROUTING_MODES,
  type CandidateDecisionTrace,
  type CapabilityRecord,
  type CapabilityRegistry,
  type DecisionTraceStore,
  type HardGateCode,
  type HardGateResult,
  type ModelExchangeOptions,
  type ModelIdentity,
  type ModelLifecycle,
  type RoutingDecision,
  type RoutingDecisionTrace,
  type RoutingMode,
  type RoutingRequest,
  type RoutingRequirements,
} from './contracts.ts';

export { InMemoryCapabilityRegistry } from './capability-registry.ts';

export { evaluateHardGates, toModelIdentity } from './hard-gates.ts';

export { evaluateLifecycle, type LifecycleDecision } from './lifecycle.ts';

export { ModelExchange, NoEligibleCandidateError, createRoutingDecisionTrace } from './router.ts';

export {
  ModelExchangeContractError,
  parseCapabilityRecord,
  parseRoutingDecisionTrace,
  parseRoutingRequest,
} from './validation.ts';
