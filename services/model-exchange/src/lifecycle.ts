import type { ModelLifecycle, RoutingMode } from './contracts.ts';

export interface LifecycleDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export function evaluateLifecycle(lifecycle: ModelLifecycle, mode: RoutingMode): LifecycleDecision {
  if (lifecycle === 'PRODUCTION') {
    return Object.freeze({
      allowed: true,
      reason: 'PRODUCTION is eligible for authoritative routing.',
    });
  }

  if (lifecycle === 'CANARY' && mode === 'EXPERIMENT') {
    return Object.freeze({
      allowed: true,
      reason: 'CANARY is eligible only because the request mode is EXPERIMENT.',
    });
  }

  if (lifecycle === 'CANARY') {
    return Object.freeze({
      allowed: false,
      reason: 'CANARY is blocked outside EXPERIMENT mode.',
    });
  }

  return Object.freeze({
    allowed: false,
    reason: `${lifecycle} cannot be an authoritative winner or fallback.`,
  });
}
