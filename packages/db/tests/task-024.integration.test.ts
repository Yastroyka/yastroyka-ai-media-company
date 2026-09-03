import assert from 'node:assert/strict';
import test from 'node:test';

const TEST_DATABASE_HOST = '127.0.0.1';
const TEST_DATABASE_NAME = 'yastroyka_r1_test';
const MASTER_CONTENT_ID = '00000000-0000-4000-8000-000000000240';
const VK_COMMUNITY_OLD_ID = '00000000-0000-4000-8000-000000000241';
const VK_COMMUNITY_AUTO_ID = '00000000-0000-4000-8000-000000000242';
const VK_COMMUNITY_NEW_ID = '00000000-0000-4000-8000-000000000243';
const VK_VIDEO_ID = '00000000-0000-4000-8000-000000000244';

process.env.YASTROYKA_DB_HOST = TEST_DATABASE_HOST;
process.env.YASTROYKA_DB_NAME = TEST_DATABASE_NAME;

const { createDatabaseConnection } = await import('../src/connection.ts');
const { createMigrator } = await import('../src/migrator.ts');
const { createPostgresPlatformWorkspaceStore } =
  await import('../src/postgres-platform-workspace-store.ts');
const { createPostgresPublicationDiscoveryStore } =
  await import('../src/postgres-publication-discovery-store.ts');

test('TASK-024 publication discovery is metadata-only, bounded and platform-scoped', async (t) => {
  const database = createDatabaseConnection();

  try {
    const migrator = createMigrator(database);
    await migrator.up();
    await database.query(
      `DELETE FROM publications WHERE master_content_id = '${MASTER_CONTENT_ID}';`,
    );

    const workspaceStore = createPostgresPlatformWorkspaceStore(database);
    const discoveryStore = createPostgresPublicationDiscoveryStore(database);

    await workspaceStore.createDraft({
      publicationId: VK_COMMUNITY_OLD_ID,
      masterContentId: MASTER_CONTENT_ID,
      workspaceId: 'yastroyka-vk-community-old',
      platform: 'VK_COMMUNITY',
      payload: { text: 'old payload must never be selected by discovery' },
    });
    await workspaceStore.createDraft({
      publicationId: VK_COMMUNITY_AUTO_ID,
      masterContentId: MASTER_CONTENT_ID,
      workspaceId: 'yastroyka-vk-community-auto',
      platform: 'VK_COMMUNITY',
      payload: { text: 'auto payload must never be selected by discovery' },
    });
    await workspaceStore.createDraft({
      publicationId: VK_COMMUNITY_NEW_ID,
      masterContentId: MASTER_CONTENT_ID,
      workspaceId: 'yastroyka-vk-community-new',
      platform: 'VK_COMMUNITY',
      payload: { text: 'new payload must never be selected by discovery' },
    });
    await workspaceStore.createDraft({
      publicationId: VK_VIDEO_ID,
      masterContentId: MASTER_CONTENT_ID,
      workspaceId: 'yastroyka-vk-video',
      platform: 'VK_VIDEO',
      payload: { title: 'VK Video must never enter VK Community discovery' },
    });

    await database.query(
      `
        UPDATE publications
        SET status = 'AUTO'
        WHERE id = '${VK_COMMUNITY_AUTO_ID}';

        UPDATE publications
        SET created_at = TIMESTAMPTZ '2026-09-01T10:00:00Z'
        WHERE id = '${VK_COMMUNITY_OLD_ID}';

        UPDATE publications
        SET created_at = TIMESTAMPTZ '2026-09-01T11:00:00Z'
        WHERE id = '${VK_COMMUNITY_AUTO_ID}';

        UPDATE publications
        SET created_at = TIMESTAMPTZ '2026-09-01T12:00:00Z'
        WHERE id = '${VK_COMMUNITY_NEW_ID}';
      `,
    );

    await t.test(
      'recent VK Community rows are newest-first and exclude other platforms',
      async () => {
        const records = await discoveryStore.listRecentByPlatform('VK_COMMUNITY', 3);

        assert.deepEqual(
          records.map((record) => record.publicationId),
          [VK_COMMUNITY_NEW_ID, VK_COMMUNITY_AUTO_ID, VK_COMMUNITY_OLD_ID],
        );
        assert.deepEqual(
          records.map((record) => record.platform),
          ['VK_COMMUNITY', 'VK_COMMUNITY', 'VK_COMMUNITY'],
        );
        assert.equal(
          records.some((record) => record.publicationId === VK_VIDEO_ID),
          false,
        );
        assert.equal(records[1]?.status, 'AUTO');
      },
    );

    await t.test('discovery result shape contains no payload field', async () => {
      const [record] = await discoveryStore.listRecentByPlatform('VK_COMMUNITY', 1);
      assert.notEqual(record, undefined);
      assert.equal(Object.hasOwn(record as object, 'payload'), false);
      assert.deepEqual(Object.keys(record ?? {}).sort(), [
        'createdAt',
        'masterContentId',
        'platform',
        'publicationId',
        'publishedAt',
        'status',
        'workspaceId',
      ]);
    });

    await t.test('limit is enforced by the query and invalid limits fail closed', async () => {
      const records = await discoveryStore.listRecentByPlatform('VK_COMMUNITY', 2);
      assert.equal(records.length, 2);
      await assert.rejects(discoveryStore.listRecentByPlatform('VK_COMMUNITY', 0), /limit/u);
      await assert.rejects(discoveryStore.listRecentByPlatform('VK_COMMUNITY', 51), /limit/u);
      await assert.rejects(discoveryStore.listRecentByPlatform('VK_COMMUNITY', 1.5), /limit/u);
    });
  } finally {
    await database
      .query(`DELETE FROM publications WHERE master_content_id = '${MASTER_CONTENT_ID}';`)
      .catch(() => undefined);
    await database.close();
  }
});
