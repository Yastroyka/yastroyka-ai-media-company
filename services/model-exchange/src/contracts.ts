export const MODEL_LIFECYCLES = [
  'DISCOVERED',
  'QUARANTINE',
  'BENCHMARK',
  'SHADOW',
  'CANARY',
  'PRODUCTION',
  'SUSPENDED',
  'REVOKED',
] as const;

export type ModelLifecycle = (typeof MODEL_LIFECYCLES)[number];

export const ROUTING_MODES = [
  'MAX_QUALITY',
  'BEST_VALUE',
  'FAST',
  'BULK',
  'EXPERIMENT',
  'REDUNDANT',
  'CRITICAL',
] as const;

export type RoutingMode = (typeof ROUTING_MODES)[number];

export interface CapabilityRecord {
  readonly model_id: string;
  readonly provider: string;
  readonly revision: string;
  readonly task_classes: readonly string[];
  readonly scores: Readonly<Partial<Record<RoutingMode, number | null>>>;
  readonly lifecycle: ModelLifecycle;
  readonly verified_at: string;
}

export interface RoutingRequirements {
  readonly provider?: string;
  readonly revision?: string;
}

export interface RoutingRequest {
  readonly request_id: string;
  readonly task_class: string;
  readonly mode: RoutingMode;
  readonly requirements: RoutingRequirements;
}

export interface ModelIdentity {
  readonly model_id: string;
  readonly provider: string;
  readonly revision: string;
}

export const HARD_GATE_CODES = [
  'CAPABILITY_VALID',
  'TASK_CLASS_SUPPORTED',
  'LIFECYCLE_ALLOWED',
  'SCORE_AVAILABLE',
  'REQUIREMENTS_SATISFIED',
] as const;

export type HardGateCode = (typeof HARD_GATE_CODES)[number];

export interface HardGateResult {
  readonly gate: HardGateCode;
  readonly passed: boolean;
  readonly reason: string;
}

export interface CandidateDecisionTrace {
  readonly candidate: ModelIdentity;
  readonly eligible: boolean;
  readonly score: number | null;
  readonly gates: readonly HardGateResult[];
  readonly excluded_reasons: readonly string[];
}

export interface RoutingDecision {
  readonly decision_id: string;
  readonly request_id: string;
  readonly winner: ModelIdentity;
  readonly fallbacks: readonly ModelIdentity[];
  readonly why_this_model: string;
  readonly confidence: number | null;
}

export interface RoutingDecisionTrace extends RoutingDecision {
  readonly created_at: string;
  readonly request: RoutingRequest;
  readonly task_class: string;
  readonly mode: RoutingMode;
  readonly selected_score: number;
  readonly candidates: readonly CandidateDecisionTrace[];
}

export interface CapabilityRegistry {
  list(): Promise<readonly unknown[]>;
}

export interface DecisionTraceStore {
  record(trace: RoutingDecisionTrace): Promise<RoutingDecisionTrace>;
}

export interface ModelExchangeOptions {
  readonly createDecisionId?: () => string;
  readonly now?: () => Date;
}
