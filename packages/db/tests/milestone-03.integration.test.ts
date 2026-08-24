import assert from 'node:assert/strict';
import test from 'node:test';

const TEST_DATABASE_HOST = '127.0.0.1';
const TEST_DATABASE_NAME = 'yastroyka_r1_test';
const RECORDED_AT = '2026-08-24T21:30:00.000Z';

process.env.YASTROYKA_DB_HOST = TEST_DATABASE_HOST;
process.env.YASTROYKA_DB_NAME = TEST_DATABASE_NAME;

const { createDatabaseConnection } = await import('../src/connection.ts');
const { createMigrator } = await import('../src/migrator.ts');
const {
  EngineeringEvidenceConflictError,
  createPostgresEngineeringEvidenceStore,
} = await import('../src/postgres-engineering-evidence-store.ts');

function evidence(sequence: number, eventType: string, status: string) {
  return {
    runId: 'm03-evidence-run-001',
    sequence,
    eventType,
    payload: {
      state: {
        runId: 'm03-evidence-run-001',
        taskId: 'MILESTONE-03',
        status,
        decisionState: status === 'ready_for_owner_decision' ? 'READY_FOR_OWNER_DECISION' : 'PENDING',
        baseSha: 'a8cc2df1ce99e140f7d1e2ce093ff0a57bcde453',
        branch: 'milestone-03/model-routing-evidence',
      },
      headSha: sequence === 1 ? null : '1111111111111111111111111111111111111111',
      activeModel:
        sequence === 1
          ? null
          : {
              provider: 'openai',
              model: 'codex-engineering',
              revision: 'r1',
            },
    },
    recordedAt: RECORDED_AT,
  };
}

test('MILESTONE-03 PostgreSQL engineering evidence is append-only and sanitized', async (t) => {
  const database = createDatabaseConnection();

  try {
    const [identityRows] = await database.query(`
      SELECT current_database() AS database;
    `);
    const identity = identityRows[0] as { database: string };
    assert.equal(
      identity.database,
      TEST_DATABASE_NAME,
      `Safety guard failed: connected to ${identity.database}`,
    );

    const migrator = createMigrator(database);
    await migrator.up();
    await database.query(`DELETE FROM engineering_run_evidence WHERE run_id LIKE 'm03-%';`);

    const store = createPostgresEngineeringEvidenceStore(database);

    await t.test('migration creates evidence table and run-time index', async () => {
      const [tables] = await database.query(`
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
          AND tablename = 'engineering_run_evidence';
      `);
      const [indexes] = await database.query(`
        SELECT indexname
        FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'engineering_run_evidence'
          AND indexname = 'idx_engineering_run_evidence_run_recorded_at';
      `);

      assert.equal(tables.length, 1);
      assert.equal(indexes.length, 1);
    });

    await t.test('ordered full snapshots persist as canonical run evidence', async () => {
      await store.record(evidence(1, 'model_selected', 'approved'));
      await store.record(evidence(2, 'ci_passed', 'ready_for_owner_decision'));

      const records = await store.findByRunId('m03-evidence-run-001');

      assert.deepEqual(
        records.map((record) => record.sequence),
        [1, 2],
      );
      assert.deepEqual(
        records.map((record) => record.eventType),
        ['model_selected', 'ci_passed'],
      );
      assert.equal(
        (records[1]?.payload as { state?: { status?: string } }).state?.status,
        'ready_for_owner_decision',
      );
    });

    await t.test('same sequence is idempotent but conflicting evidence is rejected', async () => {
      const original = evidence(3, 'validation_passed', 'reviewing');
      await store.record(original);
      await store.record(structuredClone(original));

      await assert.rejects(
        store.record({
          ...original,
          eventType: 'blocked',
          payload: { ...original.payload, changed: true },
        }),
        EngineeringEvidenceConflictError,
      );
    });

    await t.test('sensitive evidence keys fail closed before persistence', async () => {
      await assert.rejects(
        store.record({
          ...evidence(4, 'blocked', 'blocked'),
          payload: {
            provider_token: 'must-never-persist',
          },
        }),
        /Sensitive evidence field is not allowed/u,
      );

      const records = await store.findByRunId('m03-evidence-run-001');
      assert.equal(records.some((record) => record.sequence === 4), false);
      assert.equal(JSON.stringify(records).includes('must-never-persist'), false);
    });

    await database.query(`DELETE FROM engineering_run_evidence WHERE run_id LIKE 'm03-%';`);

    await t.test('0004 migration is independently reversible', async () => {
      const reverted = await migrator.down({ migrations: ['0004-engineering-run-evidence'] });
      assert.deepEqual(
        reverted.map((migration) => migration.name),
        ['0004-engineering-run-evidence'],
      );

      const [tablesAfterDown] = await database.query(`
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
          AND tablename = 'engineering_run_evidence';
      `);
      assert.equal(tablesAfterDown.length, 0);

      const restored = await migrator.up({ migrations: ['0004-engineering-run-evidence'] });
      assert.deepEqual(
        restored.map((migration) => migration.name),
        ['0004-engineering-run-evidence'],
      );
    });
  } finally {
    await database.close();
  }
});
