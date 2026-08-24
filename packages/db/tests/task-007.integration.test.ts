import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ModelExchange,
  createRoutingDecisionTrace,
  type CapabilityRecord,
} from '@yastroyka/model-exchange';

const TEST_DATABASE_HOST = '127.0.0.1';
const TEST_DATABASE_NAME = 'yastroyka_r1_test';
const VERIFIED_AT = '2026-08-24T08:00:00.000Z';
const CREATED_AT = '2026-08-24T09:00:00.000Z';

process.env.YASTROYKA_DB_HOST = TEST_DATABASE_HOST;
process.env.YASTROYKA_DB_NAME = TEST_DATABASE_NAME;

const { createDatabaseConnection } = await import('../src/connection.ts');
const { createMigrator } = await import('../src/migrator.ts');
const {
  RoutingDecisionConflictError,
  createPostgresCapabilityRegistry,
  createPostgresDecisionTraceStore,
} = await import('../src/postgres-model-exchange-store.ts');

function capability(modelId: string, score: number): CapabilityRecord {
  return {
    model_id: modelId,
    provider: `provider-${modelId}`,
    revision: 'r1',
    task_classes: ['TEXT_GENERATION'],
    scores: { MAX_QUALITY: score },
    lifecycle: 'PRODUCTION',
    verified_at: VERIFIED_AT,
  };
}

test('TASK-007 PostgreSQL capability registry and decision trace', async (t) => {
  const database = createDatabaseConnection();

  try {
    const [identityRows] = await database.query(`
      SELECT
        current_database() AS database,
        current_user AS username;
    `);
    const identity = identityRows[0] as { database: string; username: string };

    assert.equal(
      identity.database,
      TEST_DATABASE_NAME,
      `Safety guard failed: connected to ${identity.database}`,
    );

    const migrator = createMigrator(database);
    await migrator.up();

    await database.query(`DELETE FROM routing_decisions WHERE request_id LIKE 'task007-%';`);
    await database.query(`DELETE FROM model_capabilities WHERE model_id LIKE 'task007-%';`);

    const registry = createPostgresCapabilityRegistry(database);
    const store = createPostgresDecisionTraceStore(database);

    await t.test('migration up creates canonical registry and request uniqueness', async () => {
      const [tables] = await database.query(`
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
          AND tablename = 'model_capabilities';
      `);
      const [indexes] = await database.query(`
        SELECT indexname
        FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'routing_decisions'
          AND indexname = 'idx_routing_decisions_request_id_unique';
      `);

      assert.equal(tables.length, 1);
      assert.equal(indexes.length, 1);
    });

    await t.test(
      'decision trace persists and reads back without unsafe score payload',
      async () => {
        await registry.upsert({
          ...capability('task007-model-a', 0.91),
          scores: { MAX_QUALITY: 0.91, provider_secret: 'must-not-persist' },
        });
        await registry.upsert(capability('task007-model-b', 0.82));

        const exchange = new ModelExchange(registry, store, {
          createDecisionId: () => '00000000-0000-4000-8000-000000000071',
          now: () => new Date(CREATED_AT),
        });
        const decision = await exchange.route({
          request_id: 'task007-persisted-route',
          task_class: 'TEXT_GENERATION',
          mode: 'MAX_QUALITY',
          requirements: {},
        });
        const persisted = await store.findByRequestId('task007-persisted-route');

        assert.ok(persisted);
        assert.deepEqual(persisted.request, {
          request_id: 'task007-persisted-route',
          task_class: 'TEXT_GENERATION',
          mode: 'MAX_QUALITY',
          requirements: {},
        });
        assert.equal(persisted.winner.model_id, 'task007-model-a');
        assert.deepEqual(
          persisted.fallbacks.map((fallback) => fallback.model_id),
          ['task007-model-b'],
        );
        assert.equal(persisted.candidates.length, 2);
        assert.ok(persisted.why_this_model.length > 0);
        assert.equal(decision.decision_id, persisted.decision_id);
        assert.equal(JSON.stringify(persisted).includes('must-not-persist'), false);
        assert.equal(JSON.stringify(persisted).includes('provider_secret'), false);
      },
    );

    await t.test('same request and outcome is idempotent; changed outcome conflicts', async () => {
      const request = {
        request_id: 'task007-idempotent-route',
        task_class: 'TEXT_GENERATION',
        mode: 'MAX_QUALITY',
        requirements: {},
      } as const;
      const first = createRoutingDecisionTrace(
        request,
        [capability('task007-idempotent-a', 0.9), capability('task007-idempotent-b', 0.8)],
        {
          createDecisionId: () => '00000000-0000-4000-8000-000000000072',
          now: () => new Date(CREATED_AT),
        },
      );
      const retry = createRoutingDecisionTrace(
        request,
        [capability('task007-idempotent-b', 0.8), capability('task007-idempotent-a', 0.9)],
        {
          createDecisionId: () => '00000000-0000-4000-8000-000000000073',
          now: () => new Date('2026-08-24T10:00:00.000Z'),
        },
      );
      const changed = createRoutingDecisionTrace(
        request,
        [capability('task007-idempotent-a', 0.7), capability('task007-idempotent-b', 0.95)],
        {
          createDecisionId: () => '00000000-0000-4000-8000-000000000074',
          now: () => new Date('2026-08-24T11:00:00.000Z'),
        },
      );

      const persisted = await store.record(first);
      const retried = await store.record(retry);

      assert.equal(retried.decision_id, persisted.decision_id);
      await assert.rejects(store.record(changed), RoutingDecisionConflictError);
    });

    await t.test('invalid persistence input fails closed', async () => {
      const invalid = createRoutingDecisionTrace(
        {
          request_id: 'task007-invalid-persistence',
          task_class: 'TEXT_GENERATION',
          mode: 'MAX_QUALITY',
          requirements: {},
        },
        [capability('task007-invalid-a', 0.9), capability('task007-invalid-b', 0.8)],
        {
          createDecisionId: () => 'not-a-postgres-uuid',
          now: () => new Date(CREATED_AT),
        },
      );

      await assert.rejects(store.record(invalid));
      assert.equal(await store.findByRequestId('task007-invalid-persistence'), null);
    });

    await database.query(`DELETE FROM routing_decisions WHERE request_id LIKE 'task007-%';`);
    await database.query(`DELETE FROM model_capabilities WHERE model_id LIKE 'task007-%';`);

    await t.test('migration down and up are reversible', async () => {
      const reverted = await migrator.down();

      assert.deepEqual(
        reverted.map((migration) => migration.name),
        ['0003-model-exchange-core'],
      );

      const [tablesAfterDown] = await database.query(`
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
          AND tablename = 'model_capabilities';
      `);
      const [indexesAfterDown] = await database.query(`
        SELECT indexname
        FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'idx_routing_decisions_request_id_unique';
      `);

      assert.equal(tablesAfterDown.length, 0);
      assert.equal(indexesAfterDown.length, 0);

      const restored = await migrator.up({ migrations: ['0003-model-exchange-core'] });

      assert.deepEqual(
        restored.map((migration) => migration.name),
        ['0003-model-exchange-core'],
      );
    });
  } finally {
    await database.close();
  }
});
