import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

const TEST_DATABASE_HOST = '127.0.0.1';
const TEST_DATABASE_NAME = 'yastroyka_r1_test';
const MASTER_CONTENT_ID = '00000000-0000-4000-8000-000000000200';
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000201';
const OWNER_ID = -123456;
const POST_ID = 4242;
const GUID = 'a'.repeat(64);
const PUBLISHED_AT = '2026-08-26T20:30:00.000Z';
const POLICY_PATH = resolve(process.cwd(), '../../specs/authz/policy-contract.yaml');

process.env.YASTROYKA_DB_HOST = TEST_DATABASE_HOST;
process.env.YASTROYKA_DB_NAME = TEST_DATABASE_NAME;

const { loadPolicyContract } = await import('@yastroyka/auth');
const { createDatabaseConnection } = await import('../src/connection.ts');
const { createMigrator } = await import('../src/migrator.ts');
const { createPostgresAuthorizationAuditSink } =
  await import('../src/postgres-authorization-audit-sink.ts');
const { PublishingAuthorizationDeniedError } = await import('../src/postgres-publishing-store.ts');
const { createPostgresPlatformWorkspaceStore } =
  await import('../src/postgres-platform-workspace-store.ts');
const { VkCommunityResultStateConflictError, createPostgresVkCommunityResultStore } =
  await import('../src/postgres-vk-community-result-store.ts');

function objectValue(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && !Array.isArray(value) && typeof value === 'object');
  return value as Record<string, unknown>;
}

test('FIRST REAL VK POST result persistence is authorized, canonical and retry-idempotent', async (t) => {
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
    await database.query(`DELETE FROM publications WHERE id = '${PUBLICATION_ID}';`);
    await database.query(
      `DELETE FROM authorization_audit_events WHERE resource = 'publication' AND action = 'record_result';`,
    );

    const workspaces = createPostgresPlatformWorkspaceStore(database);
    await workspaces.createDraft({
      publicationId: PUBLICATION_ID,
      masterContentId: MASTER_CONTENT_ID,
      workspaceId: 'yastroyka-vk-community',
      platform: 'VK_COMMUNITY',
      payload: {
        vk_community: {
          message: 'Canonical VK result persistence test',
        },
      },
    });
    await database.query(
      `UPDATE publications SET status = 'AUTO' WHERE id = :publicationId AND platform = 'VK_COMMUNITY';`,
      { replacements: { publicationId: PUBLICATION_ID } },
    );

    const authorizationPolicy = loadPolicyContract(POLICY_PATH);
    const authorizationAuditSink = createPostgresAuthorizationAuditSink(database);
    const results = createPostgresVkCommunityResultStore(database, {
      authorizationPolicy,
      authorizationAuditSink,
    });

    await t.test('AI actor is denied and denial is audited before mutation', async () => {
      await assert.rejects(
        results.recordSuccess({
          publicationId: PUBLICATION_ID,
          actorId: 'claude_orchestrator',
          ownerId: OWNER_ID,
          postId: POST_ID,
          idempotencyKey: GUID,
          publishedAt: PUBLISHED_AT,
        }),
        PublishingAuthorizationDeniedError,
      );
      assert.equal((await workspaces.findById(PUBLICATION_ID))?.status, 'AUTO');

      const [auditRows] = await database.query(
        `
          SELECT actor_id, resource, action, decision
          FROM authorization_audit_events
          WHERE actor_id = 'claude_orchestrator'
            AND resource = 'publication'
            AND action = 'record_result'
          ORDER BY occurred_at DESC
          LIMIT 1;
        `,
      );
      assert.deepEqual(auditRows[0], {
        actor_id: 'claude_orchestrator',
        resource: 'publication',
        action: 'record_result',
        decision: 'deny',
      });
    });

    const input = {
      publicationId: PUBLICATION_ID,
      actorId: 'publishing_service',
      ownerId: OWNER_ID,
      postId: POST_ID,
      idempotencyKey: GUID,
      publishedAt: PUBLISHED_AT,
    } as const;

    await t.test('authorized success persists exact VK evidence and PUBLISHED state', async () => {
      const persisted = await results.recordSuccess(input);
      assert.deepEqual(persisted, {
        publicationId: PUBLICATION_ID,
        platform: 'VK_COMMUNITY',
        status: 'PUBLISHED',
        ownerId: OWNER_ID,
        postId: POST_ID,
        idempotencyKey: GUID,
        publishedAt: PUBLISHED_AT,
      });

      const publication = await workspaces.findById(PUBLICATION_ID);
      assert.equal(publication?.status, 'PUBLISHED');
      assert.equal(publication?.publishedAt, PUBLISHED_AT);
      const payload = objectValue(publication?.payload);
      const publishing = objectValue(payload.publishing);
      const result = objectValue(publishing.result);
      const vk = objectValue(result.vk);
      assert.deepEqual(result, {
        outcome: 'SUCCESS',
        code: 'VK_WALL_POST_PUBLISHED',
        external_id: String(POST_ID),
        vk: {
          owner_id: OWNER_ID,
          post_id: POST_ID,
          guid: GUID,
        },
      });
      assert.deepEqual(vk, {
        owner_id: OWNER_ID,
        post_id: POST_ID,
        guid: GUID,
      });
      assert.doesNotMatch(JSON.stringify(publication), /access_token|credential|password/iu);
    });

    await t.test('same already-published result is idempotent', async () => {
      assert.deepEqual(await results.recordSuccess(input), {
        publicationId: PUBLICATION_ID,
        platform: 'VK_COMMUNITY',
        status: 'PUBLISHED',
        ownerId: OWNER_ID,
        postId: POST_ID,
        idempotencyKey: GUID,
        publishedAt: PUBLISHED_AT,
      });
    });

    await t.test('different evidence cannot overwrite an existing published result', async () => {
      await assert.rejects(
        results.recordSuccess({
          ...input,
          postId: POST_ID + 1,
        }),
        VkCommunityResultStateConflictError,
      );
      await assert.rejects(
        results.recordSuccess({
          ...input,
          idempotencyKey: 'b'.repeat(64),
        }),
        VkCommunityResultStateConflictError,
      );

      const publication = await workspaces.findById(PUBLICATION_ID);
      const payload = objectValue(publication?.payload);
      const publishing = objectValue(payload.publishing);
      const result = objectValue(publishing.result);
      const vk = objectValue(result.vk);
      assert.equal(vk.post_id, POST_ID);
      assert.equal(vk.guid, GUID);
      assert.equal(publication?.publishedAt, PUBLISHED_AT);
    });
  } finally {
    await database
      .query(`DELETE FROM publications WHERE id = '${PUBLICATION_ID}';`)
      .catch(() => {});
    await database
      .query(
        `DELETE FROM authorization_audit_events WHERE resource = 'publication' AND action = 'record_result';`,
      )
      .catch(() => {});
    await database.close().catch(() => {});
  }
});
