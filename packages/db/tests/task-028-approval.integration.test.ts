import assert from 'node:assert/strict';
import test from 'node:test';

const TEST_DATABASE_HOST = '127.0.0.1';
const TEST_DATABASE_NAME = 'yastroyka_r1_test';

process.env.YASTROYKA_DB_HOST = TEST_DATABASE_HOST;
process.env.YASTROYKA_DB_NAME = TEST_DATABASE_NAME;

const { createDatabaseConnection, createReadOnlyDatabaseConnection } =
  await import('../src/connection.ts');
const { createMigrator } = await import('../src/migrator.ts');
const { createPostgresApprovalDiscoveryStore } =
  await import('../src/postgres-approval-discovery-store.ts');

test('TASK-028 summarizes pending owner approvals through a read-only connection', async (t) => {
  const database = createDatabaseConnection();
  const readOnlyDatabase = createReadOnlyDatabaseConnection();

  try {
    const migrator = createMigrator(database);
    await migrator.up();
    await database.query('DELETE FROM approvals;');

    await database.query(`
      INSERT INTO approvals (
        id,
        aggregate_type,
        aggregate_id,
        status,
        requested_by,
        decided_by,
        created_at,
        decided_at
      )
      VALUES
        (
          '00000000-0000-4000-8000-000000000291',
          'publication',
          '00000000-0000-4000-8000-000000000391',
          'PENDING',
          'publishing_service',
          NULL,
          TIMESTAMPTZ '2026-09-10T11:00:00.000Z',
          NULL
        ),
        (
          '00000000-0000-4000-8000-000000000292',
          'publication',
          '00000000-0000-4000-8000-000000000392',
          'PENDING',
          'publishing_service',
          NULL,
          TIMESTAMPTZ '2026-09-10T12:00:00.000Z',
          NULL
        ),
        (
          '00000000-0000-4000-8000-000000000293',
          'publication',
          '00000000-0000-4000-8000-000000000393',
          'APPROVED',
          'publishing_service',
          'human_owner',
          TIMESTAMPTZ '2026-09-10T10:00:00.000Z',
          TIMESTAMPTZ '2026-09-10T10:30:00.000Z'
        );
    `);

    const store = createPostgresApprovalDiscoveryStore(readOnlyDatabase);

    await t.test(
      'counts only pending approvals and returns the oldest pending timestamp',
      async () => {
        const summary = await store.getPendingSummary();

        assert.deepEqual(summary, {
          waitingCount: 2,
          oldestWaitingAt: '2026-09-10T11:00:00.000Z',
        });
        assert.deepEqual(Object.keys(summary).sort(), ['oldestWaitingAt', 'waitingCount']);
      },
    );

    await t.test('empty pending queue returns zero and null without inventing state', async () => {
      await database.query("DELETE FROM approvals WHERE status = 'PENDING';");

      assert.deepEqual(await store.getPendingSummary(), {
        waitingCount: 0,
        oldestWaitingAt: null,
      });
    });
  } finally {
    await database.query('DELETE FROM approvals;').catch(() => undefined);
    await readOnlyDatabase.close().catch(() => undefined);
    await database.close().catch(() => undefined);
  }
});
