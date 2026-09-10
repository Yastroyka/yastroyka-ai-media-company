import assert from 'node:assert/strict';
import test from 'node:test';

const TEST_DATABASE_HOST = '127.0.0.1';
const TEST_DATABASE_NAME = 'yastroyka_r1_test';
const OLDER_RUN_ID = 'task-028-engineering-run-older';
const LATEST_RUN_ID = 'task-028-engineering-run-latest';

process.env.YASTROYKA_DB_HOST = TEST_DATABASE_HOST;
process.env.YASTROYKA_DB_NAME = TEST_DATABASE_NAME;

const { createDatabaseConnection } = await import('../src/connection.ts');
const { createMigrator } = await import('../src/migrator.ts');
const { createPostgresEngineeringEvidenceStore } =
  await import('../src/postgres-engineering-evidence-store.ts');

function engineeringEvidence(
  runId: string,
  sequence: number,
  recordedAt: string,
  status: string,
) {
  return {
    runId,
    sequence,
    eventType: sequence === 1 ? 'model_selected' : 'ci_passed',
    payload: {
      state: {
        runId,
        taskId: 'TASK-028',
        status,
        decisionState:
          status === 'ready_for_owner_decision' ? 'READY_FOR_OWNER_DECISION' : 'PENDING',
        baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        branch: 'feat/task-028-control-room-read-model-discovery',
      },
      headSha: sequence === 1 ? null : 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      activeModel: null,
      routingDecision: null,
    },
    recordedAt,
  };
}

test('TASK-028 discovers the latest engineering evidence deterministically', async (t) => {
  const database = createDatabaseConnection();

  try {
    const migrator = createMigrator(database);
    await migrator.up();
    await database.query(
      `DELETE FROM engineering_run_evidence WHERE run_id LIKE 'task-028-engineering-run-%';`,
    );

    const store = createPostgresEngineeringEvidenceStore(database);

    await store.record(
      engineeringEvidence(OLDER_RUN_ID, 1, '2026-09-10T12:00:00.000Z', 'approved'),
    );
    await store.record(
      engineeringEvidence(LATEST_RUN_ID, 1, '2026-09-10T13:00:00.000Z', 'approved'),
    );
    await store.record(
      engineeringEvidence(
        LATEST_RUN_ID,
        2,
        '2026-09-10T13:00:00.000Z',
        'ready_for_owner_decision',
      ),
    );

    await t.test('newest timestamp wins and sequence breaks ties within the run', async () => {
      const latest = await store.findLatest();

      assert.notEqual(latest, null);
      assert.equal(latest?.runId, LATEST_RUN_ID);
      assert.equal(latest?.sequence, 2);
      assert.equal(latest?.eventType, 'ci_passed');
      assert.equal(
        (latest?.payload as { state?: { status?: string } }).state?.status,
        'ready_for_owner_decision',
      );
    });

    await t.test('empty evidence returns null instead of inventing a run', async () => {
      await database.query(
        `DELETE FROM engineering_run_evidence WHERE run_id LIKE 'task-028-engineering-run-%';`,
      );
      const latest = await store.findLatest();
      assert.equal(latest, null);
    });
  } finally {
    await database
      .query(`DELETE FROM engineering_run_evidence WHERE run_id LIKE 'task-028-engineering-run-%';`)
      .catch(() => undefined);
    await database.close();
  }
});
