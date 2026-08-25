import assert from 'node:assert/strict';
import test from 'node:test';

const TEST_DATABASE_HOST = '127.0.0.1';
const TEST_DATABASE_NAME = 'yastroyka_r1_test';
const MASTER_CONTENT_ID = '00000000-0000-4000-8000-000000000090';
const VK_COMMUNITY_PUBLICATION_ID = '00000000-0000-4000-8000-000000000091';
const VK_VIDEO_PUBLICATION_ID = '00000000-0000-4000-8000-000000000092';
const MAX_PUBLICATION_ID = '00000000-0000-4000-8000-000000000093';

process.env.YASTROYKA_DB_HOST = TEST_DATABASE_HOST;
process.env.YASTROYKA_DB_NAME = TEST_DATABASE_NAME;

const { createDatabaseConnection } = await import('../src/connection.ts');
const { createMigrator } = await import('../src/migrator.ts');
const { PlatformPublicationStateConflictError, createPostgresPlatformWorkspaceStore } =
  await import('../src/postgres-platform-workspace-store.ts');

test('TASK-009 platform workspaces persist independent publication state', async (t) => {
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
    await database.query(
      `DELETE FROM publications WHERE master_content_id = '${MASTER_CONTENT_ID}';`,
    );

    const store = createPostgresPlatformWorkspaceStore(database);

    await t.test('each platform receives its own publication identity', async () => {
      const vkCommunity = await store.createDraft({
        publicationId: VK_COMMUNITY_PUBLICATION_ID,
        masterContentId: MASTER_CONTENT_ID,
        workspaceId: 'yastroyka-vk-community',
        platform: 'VK_COMMUNITY',
        payload: { text: 'VK Community draft' },
      });
      const vkVideo = await store.createDraft({
        publicationId: VK_VIDEO_PUBLICATION_ID,
        masterContentId: MASTER_CONTENT_ID,
        workspaceId: 'yastroyka-vk-video',
        platform: 'VK_VIDEO',
        payload: { title: 'VK Video draft' },
      });
      const max = await store.createDraft({
        publicationId: MAX_PUBLICATION_ID,
        masterContentId: MASTER_CONTENT_ID,
        workspaceId: 'yastroyka-max',
        platform: 'MAX',
        payload: { text: 'MAX draft' },
      });

      assert.deepEqual(
        new Set([vkCommunity.publicationId, vkVideo.publicationId, max.publicationId]).size,
        3,
      );
      assert.equal(vkCommunity.status, 'DRAFT');
      assert.equal(vkVideo.status, 'DRAFT');
      assert.equal(max.status, 'DRAFT');
    });

    await t.test('one VK contour failure does not mutate the other contours', async () => {
      const failed = await store.markFailed(
        VK_COMMUNITY_PUBLICATION_ID,
        'VK_COMMUNITY',
        'VK_API_UNAVAILABLE',
      );
      assert.equal(failed.status, 'FAILED');
      assert.equal(failed.payload.failure_code, 'VK_API_UNAVAILABLE');

      const records = await store.listByMasterContent(MASTER_CONTENT_ID);
      const byPlatform = new Map(records.map((record) => [record.platform, record]));

      assert.equal(byPlatform.get('VK_COMMUNITY')?.status, 'FAILED');
      assert.equal(byPlatform.get('VK_VIDEO')?.status, 'DRAFT');
      assert.equal(byPlatform.get('MAX')?.status, 'DRAFT');
      assert.equal(byPlatform.get('VK_VIDEO')?.payload.failure_code, undefined);
      assert.equal(byPlatform.get('MAX')?.payload.failure_code, undefined);
    });

    await t.test('cross-platform or repeated failure transitions fail closed', async () => {
      await assert.rejects(
        store.markFailed(VK_VIDEO_PUBLICATION_ID, 'VK_COMMUNITY', 'WRONG_CONTOUR'),
        PlatformPublicationStateConflictError,
      );
      await assert.rejects(
        store.markFailed(VK_COMMUNITY_PUBLICATION_ID, 'VK_COMMUNITY', 'REPEATED_FAILURE'),
        PlatformPublicationStateConflictError,
      );

      assert.equal((await store.findById(VK_VIDEO_PUBLICATION_ID))?.status, 'DRAFT');
    });

    await t.test(
      'unsupported platform and unsafe payloads are rejected before persistence',
      async () => {
        await assert.rejects(
          store.createDraft({
            publicationId: '00000000-0000-4000-8000-000000000094',
            masterContentId: MASTER_CONTENT_ID,
            workspaceId: 'unsupported-platform',
            platform: 'TELEGRAM' as never,
            payload: {},
          }),
          /Unsupported publication platform/u,
        );

        await assert.rejects(
          store.createDraft({
            publicationId: '00000000-0000-4000-8000-000000000095',
            masterContentId: MASTER_CONTENT_ID,
            workspaceId: 'yastroyka-vk-community',
            platform: 'VK_COMMUNITY',
            payload: { access_token: 'must-not-persist' },
          }),
          /must not contain credentials or secret material/u,
        );

        await assert.rejects(
          store.createDraft({
            publicationId: '00000000-0000-4000-8000-000000000096',
            masterContentId: MASTER_CONTENT_ID,
            workspaceId: 'yastroyka-vk-community',
            platform: 'VK_COMMUNITY',
            payload: [] as never,
          }),
          /Publication payload must be a JSON object/u,
        );

        await assert.rejects(
          store.createDraft({
            publicationId: '00000000-0000-4000-8000-000000000097',
            masterContentId: MASTER_CONTENT_ID,
            workspaceId: 'yastroyka-vk-community',
            platform: 'VK_COMMUNITY',
            payload: { failure_code: 'FORGED' },
          }),
          /Publication payload contains store-owned metadata/u,
        );

        for (const publicationId of [
          '00000000-0000-4000-8000-000000000094',
          '00000000-0000-4000-8000-000000000095',
          '00000000-0000-4000-8000-000000000096',
          '00000000-0000-4000-8000-000000000097',
        ]) {
          assert.equal(await store.findById(publicationId), null);
        }
      },
    );

    await t.test('TASK-009 adds no shared VK publication queue', async () => {
      const [rows] = await database.query(`
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('publication_queue', 'vk_publication_queue');
      `);
      assert.equal(rows.length, 0);
    });
  } finally {
    await database
      .query(`DELETE FROM publications WHERE master_content_id = '${MASTER_CONTENT_ID}';`)
      .catch(() => undefined);
    await database.close();
  }
});
