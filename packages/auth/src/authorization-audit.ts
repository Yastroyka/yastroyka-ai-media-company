import {
  authorize,
  type AuthorizationDecision,
  type AuthorizationDenyDecision,
  type AuthorizationRequest,
} from './authorize.ts';
import type { PolicyContractV2 } from './policy-contract.ts';

export interface AuthorizationAuditSink {
  record(decision: AuthorizationDenyDecision): Promise<void>;
}

export async function authorizeAndAudit(
  policy: PolicyContractV2,
  request: AuthorizationRequest,
  auditSink: AuthorizationAuditSink,
): Promise<AuthorizationDecision> {
  const decision = authorize(policy, request);

  if (!decision.allowed) {
    await auditSink.record(decision);
  }

  return decision;
}
