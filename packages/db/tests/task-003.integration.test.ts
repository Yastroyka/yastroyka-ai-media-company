import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const TEST_DATABASE_HOST = '127.0.0.1';
const TEST_DATABASE_NAME = 'yastroyka_r1_test';

process.env.YASTROYKA_DB_HOST = TEST_DATABASE_HOST;
process.env.YASTROYKA_DB_NAME = TEST_DATABASE_NAME;

const POLICY_PATH = fileURLToPath(
  new URL('../../../specs/authz/policy-contract.yaml', import.meta.url),
);

const { authorizeAndAudit, loadPolicyContract } = await import('@yastroyka/auth');

const { createDatabaseConnection } = await import('../src/connection.ts');
const { createMigrator } = await import('../src/migrator.ts');
const { createPostgresAuthorizationAuditSink } =
  await import('../src/postgres-authorization-audit-sink.ts');

test('TASK-003 forbidden production write is denied and audited', async () => {
  const database = createDatabaseConnection();

  try {
    const [identityRows] = await database.query(`
      SELECT
        current_database() AS database,
        current_user AS username;
    `);

    const identity = identityRows[0] as {
      database: string;
      username: string;
    };

    assert.equal(
      identity.database,
      TEST_DATABASE_NAME,
      `Safety guard failed: connected to ${identity.database}`,
    );

    const migrator = createMigrator(database);
    await migrator.up();

    const policy = loadPolicyContract(POLICY_PATH);
    const auditSink = createPostgresAuthorizationAuditSink(database);

    await database.query(`
      DELETE FROM authorization_audit_events
      WHERE actor_id = 'codex_developer'
        AND resource = 'production_catalog'
        AND action = 'price_write';
    `);

    try {
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
      assert.equal(decision.decision, 'deny');
      assert.equal(decision.permission_id, 'production-catalog-price-write');
      assert.equal(decision.required_scope, 'production:write');
      assert.equal(decision.risk_class, 'R2');
      assert.equal(decision.reason, 'explicit_deny_rule');
      assert.equal(decision.matched_rule_id, 'commerce-production-read-only');

      const [auditRows] = await database.query(`
        SELECT
          actor_id,
          resource,
          action,
          permission_id,
          required_scope,
          risk_class,
          decision,
          reason,
          matched_rule_id,
          occurred_at
        FROM authorization_audit_events
        WHERE actor_id = 'codex_developer'
          AND resource = 'production_catalog'
          AND action = 'price_write'
        ORDER BY occurred_at DESC;
      `);

      assert.equal(auditRows.length, 1);

      const auditRow = auditRows[0] as {
        actor_id: string;
        resource: string;
        action: string;
        permission_id: string | null;
        required_scope: string | null;
        risk_class: string | null;
        decision: string;
        reason: string;
        matched_rule_id: string | null;
        occurred_at: Date;
      };

      assert.equal(auditRow.actor_id, 'codex_developer');
      assert.equal(auditRow.resource, 'production_catalog');
      assert.equal(auditRow.action, 'price_write');
      assert.equal(auditRow.permission_id, 'production-catalog-price-write');
      assert.equal(auditRow.required_scope, 'production:write');
      assert.equal(auditRow.risk_class, 'R2');
      assert.equal(auditRow.decision, 'deny');
      assert.equal(auditRow.reason, 'explicit_deny_rule');
      assert.equal(auditRow.matched_rule_id, 'commerce-production-read-only');
      assert.ok(auditRow.occurred_at instanceof Date);
    } finally {
      await database.query(`
        DELETE FROM authorization_audit_events
        WHERE actor_id = 'codex_developer'
          AND resource = 'production_catalog'
          AND action = 'price_write';
      `);
    }
  } finally {
    await database.close();
  }
});
