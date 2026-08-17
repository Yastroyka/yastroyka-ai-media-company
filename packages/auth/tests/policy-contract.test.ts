import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { parse } from 'yaml';

import {
  loadPolicyContract,
  PolicyContractError,
  validatePolicyContract,
} from '../src/policy-contract.ts';

const policyPath = resolve(process.cwd(), '../../specs/authz/policy-contract.yaml');

function readRawPolicy(): Record<string, unknown> {
  const source = readFileSync(policyPath, 'utf8');
  const parsed: unknown = parse(source);

  assert.equal(typeof parsed, 'object');
  assert.notEqual(parsed, null);
  assert.equal(Array.isArray(parsed), false);

  return structuredClone(parsed) as Record<string, unknown>;
}

function expectPolicyError(value: unknown, expectedMessage: string): void {
  assert.throws(
    () => validatePolicyContract(value),
    (error: unknown) => error instanceof PolicyContractError && error.message === expectedMessage,
  );
}

test('real AuthZ policy v2 validates successfully', () => {
  const policy = loadPolicyContract(policyPath);

  assert.equal(policy.version, 2);
  assert.equal(policy.principles.default_deny, true);
  assert.equal(policy.principles.least_privilege, true);
  assert.deepEqual(Object.keys(policy.risk_classes).sort(), ['R0', 'R1', 'R2', 'R3']);
  assert.deepEqual(Object.keys(policy.actors).sort(), ['claude_orchestrator', 'codex_developer']);
  assert.equal(policy.permissions.length, 9);
  assert.equal(policy.rules.length, 1);
});

test('policy fails closed when default deny is disabled', () => {
  const policy = readRawPolicy();
  const principles = policy.principles as Record<string, unknown>;

  principles.default_deny = false;

  expectPolicyError(policy, 'policy.principles.default_deny must be true');
});

test('policy rejects unknown top-level keys', () => {
  const policy = readRawPolicy();

  policy.backdoor = true;

  expectPolicyError(policy, 'policy contains unknown key: backdoor');
});

test('policy rejects unknown risk classes in permissions', () => {
  const policy = readRawPolicy();
  const permissions = policy.permissions as Array<Record<string, unknown>>;

  permissions[0]!.risk_class = 'R9';

  expectPolicyError(policy, 'policy.permissions[0].risk_class must be one of R0, R1, R2 or R3');
});

test('deny rules cannot reference unknown permissions', () => {
  const policy = readRawPolicy();
  const rules = policy.rules as Array<Record<string, unknown>>;

  rules[0]!.actions = ['unknown_write'];

  expectPolicyError(
    policy,
    'policy.rules[0] references unknown permission production_catalog:unknown_write',
  );
});

test('actor scopes cannot be both allowed and denied', () => {
  const policy = readRawPolicy();
  const actors = policy.actors as Record<string, Record<string, unknown>>;
  const codex = actors.codex_developer!;

  codex.denied_scopes = ['repo:branch_write'];

  expectPolicyError(
    policy,
    'policy.actors.codex_developer contains scopes that are both allowed and denied: repo:branch_write',
  );
});
