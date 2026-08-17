import type { PermissionPolicy, PolicyContractV2, RiskClass } from './policy-contract.ts';

export interface AuthorizationRequest {
  readonly actor_id: string;
  readonly resource: string;
  readonly action: string;
}

export type AuthorizationDenyReason =
  | 'unknown_actor'
  | 'unknown_permission'
  | 'explicit_deny_rule'
  | 'explicit_denied_scope'
  | 'missing_required_scope';

export interface AuthorizationAllowDecision {
  readonly allowed: true;
  readonly decision: 'allow';
  readonly actor_id: string;
  readonly resource: string;
  readonly action: string;
  readonly permission_id: string;
  readonly required_scope: string;
  readonly risk_class: RiskClass;
  readonly reason: 'allowed';
  readonly matched_rule_id: null;
}

export interface AuthorizationDenyDecision {
  readonly allowed: false;
  readonly decision: 'deny';
  readonly actor_id: string;
  readonly resource: string;
  readonly action: string;
  readonly permission_id: string | null;
  readonly required_scope: string | null;
  readonly risk_class: RiskClass | null;
  readonly reason: AuthorizationDenyReason;
  readonly matched_rule_id: string | null;
}

export type AuthorizationDecision = AuthorizationAllowDecision | AuthorizationDenyDecision;

function findPermission(
  policy: PolicyContractV2,
  resource: string,
  action: string,
): PermissionPolicy | undefined {
  return policy.permissions.find(
    (permission) => permission.resource === resource && permission.action === action,
  );
}

export function authorize(
  policy: PolicyContractV2,
  request: AuthorizationRequest,
): AuthorizationDecision {
  const actor = policy.actors[request.actor_id];

  if (actor === undefined) {
    return {
      allowed: false,
      decision: 'deny',
      actor_id: request.actor_id,
      resource: request.resource,
      action: request.action,
      permission_id: null,
      required_scope: null,
      risk_class: null,
      reason: 'unknown_actor',
      matched_rule_id: null,
    };
  }

  const permission = findPermission(policy, request.resource, request.action);

  if (permission === undefined) {
    return {
      allowed: false,
      decision: 'deny',
      actor_id: request.actor_id,
      resource: request.resource,
      action: request.action,
      permission_id: null,
      required_scope: null,
      risk_class: null,
      reason: 'unknown_permission',
      matched_rule_id: null,
    };
  }

  const denyRule = policy.rules.find(
    (rule) => rule.resource === request.resource && rule.actions.includes(request.action),
  );

  if (denyRule !== undefined) {
    return {
      allowed: false,
      decision: 'deny',
      actor_id: request.actor_id,
      resource: request.resource,
      action: request.action,
      permission_id: permission.id,
      required_scope: permission.required_scope,
      risk_class: permission.risk_class,
      reason: 'explicit_deny_rule',
      matched_rule_id: denyRule.id,
    };
  }

  if (actor.denied_scopes?.includes(permission.required_scope) === true) {
    return {
      allowed: false,
      decision: 'deny',
      actor_id: request.actor_id,
      resource: request.resource,
      action: request.action,
      permission_id: permission.id,
      required_scope: permission.required_scope,
      risk_class: permission.risk_class,
      reason: 'explicit_denied_scope',
      matched_rule_id: null,
    };
  }

  if (!actor.default_scopes.includes(permission.required_scope)) {
    return {
      allowed: false,
      decision: 'deny',
      actor_id: request.actor_id,
      resource: request.resource,
      action: request.action,
      permission_id: permission.id,
      required_scope: permission.required_scope,
      risk_class: permission.risk_class,
      reason: 'missing_required_scope',
      matched_rule_id: null,
    };
  }

  return {
    allowed: true,
    decision: 'allow',
    actor_id: request.actor_id,
    resource: request.resource,
    action: request.action,
    permission_id: permission.id,
    required_scope: permission.required_scope,
    risk_class: permission.risk_class,
    reason: 'allowed',
    matched_rule_id: null,
  };
}
