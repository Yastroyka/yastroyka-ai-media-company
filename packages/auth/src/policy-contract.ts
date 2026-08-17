import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

export const RISK_CLASSES = ['R0', 'R1', 'R2', 'R3'] as const;

export type RiskClass = (typeof RISK_CLASSES)[number];

export interface ActorPolicy {
  readonly default_scopes: readonly string[];
  readonly denied_scopes?: readonly string[];
}

export interface PermissionPolicy {
  readonly id: string;
  readonly resource: string;
  readonly action: string;
  readonly required_scope: string;
  readonly risk_class: RiskClass;
}

export interface DenyRule {
  readonly id: string;
  readonly resource: string;
  readonly actions: readonly string[];
  readonly effect: 'deny';
}

export interface PolicyContractV2 {
  readonly version: 2;
  readonly principles: {
    readonly default_deny: true;
    readonly least_privilege: true;
  };
  readonly risk_classes: Record<RiskClass, { readonly description: string }>;
  readonly actors: Readonly<Record<string, ActorPolicy>>;
  readonly permissions: readonly PermissionPolicy[];
  readonly rules: readonly DenyRule[];
}

export class PolicyContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyContractError';
  }
}

function fail(message: string): never {
  throw new PolicyContractError(message);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }

  return value as Record<string, unknown>;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path} must be a non-empty string`);
  }

  return value;
}

function expectStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${path} must be a non-empty array`);
  }

  return value.map((entry, index) => expectString(entry, `${path}[${index}]`));
}

function assertAllowedKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): void {
  const allowed = new Set(allowedKeys);

  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      fail(`${path} contains unknown key: ${key}`);
    }
  }
}

function assertScope(scope: string, path: string): void {
  if (!/^[a-z0-9_]+:[a-z0-9_]+$/.test(scope)) {
    fail(`${path} is not a valid scope`);
  }
}

function assertUnique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    fail(`${path} contains duplicate values`);
  }
}

export function validatePolicyContract(value: unknown): PolicyContractV2 {
  const root = expectRecord(value, 'policy');

  assertAllowedKeys(
    root,
    ['version', 'principles', 'risk_classes', 'actors', 'permissions', 'rules'],
    'policy',
  );

  if (root.version !== 2) {
    fail('policy.version must be exactly 2');
  }

  const principles = expectRecord(root.principles, 'policy.principles');

  assertAllowedKeys(principles, ['default_deny', 'least_privilege'], 'policy.principles');

  if (principles.default_deny !== true) {
    fail('policy.principles.default_deny must be true');
  }

  if (principles.least_privilege !== true) {
    fail('policy.principles.least_privilege must be true');
  }

  const riskClasses = expectRecord(root.risk_classes, 'policy.risk_classes');
  const riskClassKeys = Object.keys(riskClasses).sort();
  const expectedRiskClassKeys = [...RISK_CLASSES].sort();

  if (JSON.stringify(riskClassKeys) !== JSON.stringify(expectedRiskClassKeys)) {
    fail('policy.risk_classes must contain exactly R0, R1, R2 and R3');
  }

  for (const riskClass of RISK_CLASSES) {
    const definition = expectRecord(riskClasses[riskClass], `policy.risk_classes.${riskClass}`);

    assertAllowedKeys(definition, ['description'], `policy.risk_classes.${riskClass}`);
    expectString(definition.description, `policy.risk_classes.${riskClass}.description`);
  }

  const actors = expectRecord(root.actors, 'policy.actors');

  if (Object.keys(actors).length === 0) {
    fail('policy.actors must not be empty');
  }

  for (const [actorId, actorValue] of Object.entries(actors)) {
    expectString(actorId, 'policy actor id');

    const actor = expectRecord(actorValue, `policy.actors.${actorId}`);

    assertAllowedKeys(actor, ['default_scopes', 'denied_scopes'], `policy.actors.${actorId}`);

    const defaultScopes = expectStringArray(
      actor.default_scopes,
      `policy.actors.${actorId}.default_scopes`,
    );

    assertUnique(defaultScopes, `policy.actors.${actorId}.default_scopes`);

    for (const [index, scope] of defaultScopes.entries()) {
      assertScope(scope, `policy.actors.${actorId}.default_scopes[${index}]`);
    }

    if (actor.denied_scopes !== undefined) {
      const deniedScopes = expectStringArray(
        actor.denied_scopes,
        `policy.actors.${actorId}.denied_scopes`,
      );

      assertUnique(deniedScopes, `policy.actors.${actorId}.denied_scopes`);

      for (const [index, scope] of deniedScopes.entries()) {
        assertScope(scope, `policy.actors.${actorId}.denied_scopes[${index}]`);
      }

      const overlap = defaultScopes.filter((scope) => deniedScopes.includes(scope));

      if (overlap.length > 0) {
        fail(
          `policy.actors.${actorId} contains scopes that are both allowed and denied: ${overlap.join(', ')}`,
        );
      }
    }
  }

  if (!Array.isArray(root.permissions) || root.permissions.length === 0) {
    fail('policy.permissions must be a non-empty array');
  }

  const permissionIds: string[] = [];
  const permissionKeys: string[] = [];

  for (const [index, permissionValue] of root.permissions.entries()) {
    const path = `policy.permissions[${index}]`;
    const permission = expectRecord(permissionValue, path);

    assertAllowedKeys(
      permission,
      ['id', 'resource', 'action', 'required_scope', 'risk_class'],
      path,
    );

    const id = expectString(permission.id, `${path}.id`);
    const resource = expectString(permission.resource, `${path}.resource`);
    const action = expectString(permission.action, `${path}.action`);
    const requiredScope = expectString(permission.required_scope, `${path}.required_scope`);
    const riskClass = expectString(permission.risk_class, `${path}.risk_class`);

    assertScope(requiredScope, `${path}.required_scope`);

    if (!RISK_CLASSES.includes(riskClass as RiskClass)) {
      fail(`${path}.risk_class must be one of R0, R1, R2 or R3`);
    }

    permissionIds.push(id);
    permissionKeys.push(`${resource}:${action}`);
  }

  assertUnique(permissionIds, 'policy.permissions ids');
  assertUnique(permissionKeys, 'policy.permissions resource/action pairs');

  if (!Array.isArray(root.rules)) {
    fail('policy.rules must be an array');
  }

  const ruleIds: string[] = [];

  for (const [index, ruleValue] of root.rules.entries()) {
    const path = `policy.rules[${index}]`;
    const rule = expectRecord(ruleValue, path);

    assertAllowedKeys(rule, ['id', 'resource', 'actions', 'effect'], path);

    const id = expectString(rule.id, `${path}.id`);
    const resource = expectString(rule.resource, `${path}.resource`);
    const actions = expectStringArray(rule.actions, `${path}.actions`);

    if (rule.effect !== 'deny') {
      fail(`${path}.effect must be deny`);
    }

    assertUnique(actions, `${path}.actions`);

    for (const action of actions) {
      if (!permissionKeys.includes(`${resource}:${action}`)) {
        fail(`${path} references unknown permission ${resource}:${action}`);
      }
    }

    ruleIds.push(id);
  }

  assertUnique(ruleIds, 'policy.rules ids');

  return value as PolicyContractV2;
}

export function loadPolicyContract(filePath: string): PolicyContractV2 {
  const source = readFileSync(filePath, 'utf8');
  const parsed: unknown = parse(source);

  return validatePolicyContract(parsed);
}
