import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const TEST_DATABASE_HOST = '127.0.0.1';
const TEST_DATABASE_NAME = 'yastroyka_r1_test';

process.env.YASTROYKA_DB_HOST = TEST_DATABASE_HOST;
process.env.YASTROYKA_DB_NAME = TEST_DATABASE_NAME;

const { createDatabaseConnection } = await import('../src/connection.ts');

const { createMigrator } = await import('../src/migrator.ts');

const { createProjectWithOutbox } = await import('../src/project-with-outbox.ts');

test('TASK-002 canonical DB + transactional outbox', async (t) => {
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

    await t.test('migration up/down/up is reversible', async () => {
      const migrator = createMigrator(database);

      while ((await migrator.executed()).length > 0) {
        await migrator.down();
      }

      const firstUp = await migrator.up({ migrations: ['0001-initial-canonical-schema'] });

      assert.deepEqual(
        firstUp.map((migration) => migration.name),
        ['0001-initial-canonical-schema'],
      );

      const [tablesAfterUp] = await database.query(`
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename;
      `);

      assert.deepEqual(
        tablesAfterUp.map((row) => (row as { tablename: string }).tablename),
        [
          'SequelizeMeta',
          'approvals',
          'campaigns',
          'commerce_offer_snapshots',
          'outbox_events',
          'projects',
          'publications',
          'routing_decisions',
        ],
      );

      const [indexes] = await database.query(`
        SELECT indexname, indexdef
        FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'outbox_events'
        ORDER BY indexname;
      `);

      const outboxIndex = indexes.find(
        (row) => (row as { indexname: string }).indexname === 'idx_outbox_unpublished',
      ) as { indexname: string; indexdef: string } | undefined;

      assert.ok(outboxIndex);
      assert.match(outboxIndex.indexdef, /WHERE \(published_at IS NULL\)$/);

      const reverted = await migrator.down();

      assert.deepEqual(
        reverted.map((migration) => migration.name),
        ['0001-initial-canonical-schema'],
      );

      const [tablesAfterDown] = await database.query(`
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename;
      `);

      assert.deepEqual(
        tablesAfterDown.map((row) => (row as { tablename: string }).tablename),
        ['SequelizeMeta'],
      );

      const secondUp = await migrator.up({ migrations: ['0001-initial-canonical-schema'] });

      assert.deepEqual(
        secondUp.map((migration) => migration.name),
        ['0001-initial-canonical-schema'],
      );

      assert.deepEqual(
        (await migrator.pending()).map((migration) => migration.name),
        [
          '0002-authorization-audit-events',
          '0003-model-exchange-core',
          '0004-engineering-run-evidence',
          '0005-analytics-attribution',
        ],
      );
    });

    await t.test('canonical project and outbox event commit together', async () => {
      const projectId = randomUUID();
      const eventId = randomUUID();
      const projectCode = `task002-commit-${projectId.slice(0, 8)}`;

      try {
        await createProjectWithOutbox(database, {
          project: {
            id: projectId,
            code: projectCode,
            name: 'TASK-002 integration commit proof',
          },
          event: {
            id: eventId,
            eventType: 'project.created',
            payload: {
              project_id: projectId,
              code: projectCode,
            },
          },
        });

        const [projects] = await database.query(
          `
              SELECT id::text
              FROM projects
              WHERE id = $projectId;
            `,
          {
            bind: { projectId },
          },
        );

        const [events] = await database.query(
          `
              SELECT
                id::text,
                aggregate_type,
                aggregate_id,
                event_type,
                published_at
              FROM outbox_events
              WHERE id = $eventId;
            `,
          {
            bind: { eventId },
          },
        );

        assert.equal(projects.length, 1);
        assert.equal(events.length, 1);

        const event = events[0] as {
          aggregate_type: string;
          aggregate_id: string;
          event_type: string;
          published_at: Date | null;
        };

        assert.equal(event.aggregate_type, 'project');
        assert.equal(event.aggregate_id, projectId);
        assert.equal(event.event_type, 'project.created');
        assert.equal(event.published_at, null);
      } finally {
        await database.transaction(async (transaction) => {
          await database.query('DELETE FROM outbox_events WHERE id = $eventId;', {
            bind: { eventId },
            transaction,
          });

          await database.query('DELETE FROM projects WHERE id = $projectId;', {
            bind: { projectId },
            transaction,
          });
        });
      }
    });

    await t.test('outbox failure rolls canonical project back', async () => {
      const projectId = randomUUID();
      const projectCode = `task002-rollback-${projectId.slice(0, 8)}`;

      await assert.rejects(
        createProjectWithOutbox(database, {
          project: {
            id: projectId,
            code: projectCode,
            name: 'TASK-002 integration rollback proof',
          },
          event: {
            id: 'not-a-valid-uuid',
            eventType: 'project.created',
            payload: {
              project_id: projectId,
              code: projectCode,
            },
          },
        }),
      );

      const [projects] = await database.query(
        `
            SELECT id::text
            FROM projects
            WHERE id = $projectId;
          `,
        {
          bind: { projectId },
        },
      );

      const [events] = await database.query(
        `
            SELECT id::text
            FROM outbox_events
            WHERE aggregate_id = $projectId;
          `,
        {
          bind: { projectId },
        },
      );

      assert.equal(projects.length, 0);
      assert.equal(events.length, 0);
    });
  } finally {
    await database.close();
  }
});
