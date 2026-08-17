import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { authorize } from '../src/authorize.ts';
import { loadPolicyContract, validatePolicyContract } from '../src/policy-contract.ts';

const policyPath = resolve(process.cwd(), '../../specs/authz/policy-contract.yaml');
const policy = loadPolicyContract(policyPath);

test('Claude can perform an explicitly permitted commerce read', () => {
  const decision = authorize(policy, {
    actor_id: 'claude_orchestrator',
    resource: 'commerce',
    action: 'read',
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.required_scope, 'commerce:read');
  assert.equal(decision.risk_class, 'R0');
});

test('Codex can write to a repository branch', () => {
  const decision = authorize(policy, {
    actor_id: 'codex_developer',
    resource: 'repo',
    action: 'branch_write',
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.required_scope, 'repo:branch_write');
  assert.equal(decision.risk_class, 'R1');
});

test('unknown actors are denied by default', () => {
  const decision = authorize(policy, {
    actor_id: 'unknown_agent',
    resource: 'commerce',
    action: 'read',
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'unknown_actor');
});

test('unknown resource actions are denied by default', () => {
  const decision = authorize(policy, {
    actor_id: 'claude_orchestrator',
    resource: 'commerce',
    action: 'delete_everything',
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'unknown_permission');
});

test('an actor without the required scope is denied', () => {
  const decision = authorize(policy, {
    actor_id: 'claude_orchestrator',
    resource: 'repo',
    action: 'branch_write',
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'missing_required_scope');
  assert.equal(decision.required_scope, 'repo:branch_write');
});

test('production catalog writes are denied by the hard policy rule', () => {
  for (const action of ['price_write', 'stock_write', 'product_master_write']) {
    const decision = authorize(policy, {
      actor_id: 'claude_orchestrator',
      resource: 'production_catalog',
      action,
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'explicit_deny_rule');
    assert.equal(decision.risk_class, 'R2');
    assert.equal(decision.matched_rule_id, 'commerce-production-read-only');
  }
});

test('explicit denied actor scope overrides otherwise usable permission', () => {
  const modifiedPolicy: unknown = structuredClone(policy);
  const mutablePolicy = modifiedPolicy as {
    permissions: Array<Record<string, unknown>>;
  };

  mutablePolicy.permissions[4]!.required_scope = 'secrets:read_raw';

  const validatedPolicy = validatePolicyContract(modifiedPolicy);

  const decision = authorize(validatedPolicy, {
    actor_id: 'codex_developer',
    resource: 'repo',
    action: 'branch_write',
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'explicit_denied_scope');
  assert.equal(decision.required_scope, 'secrets:read_raw');
});
