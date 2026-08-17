import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { authorizeAndAudit, type AuthorizationAuditSink } from '../src/authorization-audit.ts';
import type { AuthorizationDenyDecision } from '../src/authorize.ts';
import { loadPolicyContract } from '../src/policy-contract.ts';

const policyPath = resolve(process.cwd(), '../../specs/authz/policy-contract.yaml');
const policy = loadPolicyContract(policyPath);

test('allowed actions do not require deny-audit persistence', async () => {
  let auditCalls = 0;

  const auditSink: AuthorizationAuditSink = {
    async record() {
      auditCalls += 1;
    },
  };

  const decision = await authorizeAndAudit(
    policy,
    {
      actor_id: 'claude_orchestrator',
      resource: 'commerce',
      action: 'read',
    },
    auditSink,
  );

  assert.equal(decision.allowed, true);
  assert.equal(auditCalls, 0);
});

test('forbidden production catalog write is denied and sent to audit', async () => {
  const recorded: AuthorizationDenyDecision[] = [];

  const auditSink: AuthorizationAuditSink = {
    async record(decision) {
      recorded.push(decision);
    },
  };

  const decision = await authorizeAndAudit(
    policy,
    {
      actor_id: 'codex_developer',
      resource: 'production_catalog',
      action: 'price_write',
    },
    auditSink,
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'explicit_deny_rule');
  assert.equal(decision.risk_class, 'R2');
  assert.equal(decision.matched_rule_id, 'commerce-production-read-only');

  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0], decision);
});

test('deny path fails closed when audit persistence fails', async () => {
  const auditFailure = new Error('audit unavailable');

  const auditSink: AuthorizationAuditSink = {
    async record() {
      throw auditFailure;
    },
  };

  await assert.rejects(
    () =>
      authorizeAndAudit(
        policy,
        {
          actor_id: 'codex_developer',
          resource: 'production_catalog',
          action: 'stock_write',
        },
        auditSink,
      ),
    auditFailure,
  );
});
