import assert from 'node:assert/strict';
import test from 'node:test';

const TEST_DATABASE_HOST = '127.0.0.1';
const TEST_DATABASE_NAME = 'yastroyka_r1_test';
const MASTER_CONTENT_ID = '00000000-0000-4000-8000-000000000100';
const STALE_PUBLICATION_ID = '00000000-0000-4000-8000-000000000101';
const ASSISTED_PUBLICATION_ID = '00000000-0000-4000-8000-000000000102';
const AUTO_PUBLICATION_ID = '00000000-0000-4000-8000-000000000103';
const REJECTED_PUBLICATION_ID = '00000000-0000-4000-8000-000000000104';
const FORGED_PUBLICATION_ID = '00000000-0000-4000-8000-000000000105';
const STALE_APPROVAL_ID = '00000000-0000-4000-8000-000000000111';
const ASSISTED_APPROVAL_ID = '00000000-0000-4000-8000-000000000112';
const AUTO_APPROVAL_ID = '00000000-0000-4000-8000-000000000113';
const REJECTED_APPROVAL_ID = '00000000-0000-4000-8000-000000000114';
const STALE_SNAPSHOT_ID = '00000000-0000-4000-8000-000000000121';
const ASSISTED_SNAPSHOT_ID = '00000000-0000-4000-8000-000000000122';
const AUTO_SNAPSHOT_ID = '00000000-0000-4000-8000-000000000123';
const NOW = '2026-08-25T10:10:00.000Z';

const PUBLICATION_IDS = [
  STALE_PUBLICATION_ID,
  ASSISTED_PUBLICATION_ID,
  AUTO_PUBLICATION_ID,
  REJECTED_PUBLICATION_ID,
] as const;

const SNAPSHOT_IDS = [STALE_SNAPSHOT_ID, ASSISTED_SNAPSHOT_ID, AUTO_SNAPSHOT_ID] as const;

process.env.YASTROYKA_DB_HOST = TEST_DATABASE_HOST;
process.env.YASTROYKA_DB_NAME = TEST_DATABASE_NAME;

const { createDatabaseConnection } = await import('../src/connection.ts');
const { createMigrator } = await import('../src/migrator.ts');
const { PublishingStateConflictError, createPostgresPublishingStore } =
  await import('../src/postgres-publishing-store.ts');
const { createPostgresPlatformWorkspaceStore } =
  await import('../src/postgres-platform-workspace-store.ts');

function publishingMetadata(payload: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const value = payload.publishing;
  assert.ok(value !== null && !Array.isArray(value) && typeof value === 'object');
  return value as Record<string, unknown>;
}

function snapshotPayload(
  offerId: string,
  capturedAt: string,
  ttlSeconds: number,
): Readonly<Record<string, unknown>> {
  return {
    offer_id: offerId,
    captured_at: capturedAt,
    currency: 'RUB',
    price: 1_000,
    stock: 5,
    availability: 'IN_STOCK',
    ttl_seconds: ttlSeconds,
  };
}

test('TASK-010 publishing enforces QA, approval and canonical snapshot freshness', async (t) => {
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
      `DELETE FROM approvals WHERE aggregate_id IN (${PUBLICATION_IDS.map((id) => `'${id}'`).join(', ')});`,
    );
    await database.query(
      `DELETE FROM publications WHERE master_content_id = '${MASTER_CONTENT_ID}';`,
    );
    await database.query(
      `DELETE FROM commerce_offer_snapshots WHERE id IN (${SNAPSHOT_IDS.map((id) => `'${id}'`).join(', ')});`,
    );

    const workspaces = createPostgresPlatformWorkspaceStore(database);
    const publishing = createPostgresPublishingStore(database, {
      freshnessPolicy: { refreshGraceSeconds: 60 },
      clock: () => new Date(NOW),
    });

    assert.throws(
      () =>
        createPostgresPublishingStore(database, {
          freshnessPolicy: { refreshGraceSeconds: -1 },
        }),
      /freshnessPolicy.refreshGraceSeconds/u,
    );

    await t.test('draft cannot forge store-owned publishing gate metadata', async () => {
      await assert.rejects(
        workspaces.createDraft({
          publicationId: FORGED_PUBLICATION_ID,
          masterContentId: MASTER_CONTENT_ID,
          workspaceId: 'yastroyka-vk-community',
          platform: 'VK_COMMUNITY',
          payload: {
            text: 'forged draft',
            publishing: { mode: 'AUTO', approval: 'APPROVED' },
          },
        }),
        /Publication payload contains store-owned metadata/u,
      );
      assert.equal(await workspaces.findById(FORGED_PUBLICATION_ID), null);
    });

    for (const [publicationId, suffix] of [
      [STALE_PUBLICATION_ID, 'stale'],
      [ASSISTED_PUBLICATION_ID, 'assisted'],
      [AUTO_PUBLICATION_ID, 'auto'],
      [REJECTED_PUBLICATION_ID, 'rejected'],
    ] as const) {
      await workspaces.createDraft({
        publicationId,
        masterContentId: MASTER_CONTENT_ID,
        workspaceId: 'yastroyka-vk-community',
        platform: 'VK_COMMUNITY',
        payload: { text: `VK Community ${suffix} draft` },
      });
    }

    for (const snapshot of [
      {
        id: STALE_SNAPSHOT_ID,
        productId: 'product-stale',
        offerId: 'offer-stale',
        capturedAt: '2026-08-25T10:00:00.000Z',
        ttlSeconds: 300,
      },
      {
        id: ASSISTED_SNAPSHOT_ID,
        productId: 'product-assisted',
        offerId: 'offer-assisted',
        capturedAt: '2026-08-25T10:09:30.000Z',
        ttlSeconds: 300,
      },
      {
        id: AUTO_SNAPSHOT_ID,
        productId: 'product-auto',
        offerId: 'offer-auto',
        capturedAt: '2026-08-25T10:09:50.000Z',
        ttlSeconds: 300,
      },
    ] as const) {
      await database.query(
        `
          INSERT INTO commerce_offer_snapshots (
            id,
            product_id,
            offer_id,
            seller_id,
            captured_at,
            payload
          )
          VALUES (
            :id,
            :productId,
            :offerId,
            'seller-yastroyka',
            :capturedAt,
            CAST(:payload AS jsonb)
          );
        `,
        {
          replacements: {
            id: snapshot.id,
            productId: snapshot.productId,
            offerId: snapshot.offerId,
            capturedAt: snapshot.capturedAt,
            payload: JSON.stringify(
              snapshotPayload(snapshot.offerId, snapshot.capturedAt, snapshot.ttlSeconds),
            ),
          },
        },
      );
    }

    await t.test(
      'canonical stale snapshot blocks AUTO even when caller requests AUTO',
      async () => {
        assert.equal(
          (
            await publishing.recordQaResult({
              publicationId: STALE_PUBLICATION_ID,
              platform: 'VK_COMMUNITY',
              outcome: 'PASS',
              evidenceId: 'qa-stale-001',
              code: 'QA_PASSED',
            })
          ).status,
          'QA_PASSED',
        );
        assert.equal(
          (
            await publishing.requestApproval({
              publicationId: STALE_PUBLICATION_ID,
              platform: 'VK_COMMUNITY',
              approvalId: STALE_APPROVAL_ID,
              requestedBy: 'owner',
            })
          ).status,
          'AWAITING_APPROVAL',
        );

        await assert.rejects(
          publishing.applyPreparation({
            publicationId: STALE_PUBLICATION_ID,
            platform: 'VK_COMMUNITY',
            mode: 'AUTO',
            snapshotId: STALE_SNAPSHOT_ID,
          }),
          PublishingStateConflictError,
        );

        assert.equal(
          (
            await publishing.decideApproval({
              publicationId: STALE_PUBLICATION_ID,
              platform: 'VK_COMMUNITY',
              approvalId: STALE_APPROVAL_ID,
              decision: 'APPROVED',
              decidedBy: 'owner',
            })
          ).status,
          'APPROVED',
        );

        const blocked = await publishing.applyPreparation({
          publicationId: STALE_PUBLICATION_ID,
          platform: 'VK_COMMUNITY',
          mode: 'AUTO',
          snapshotId: STALE_SNAPSHOT_ID,
        });
        assert.equal(blocked.status, 'BLOCKED');
        assert.equal(blocked.publishedAt, null);
        assert.deepEqual(publishingMetadata(blocked.payload).freshness, {
          status: 'BLOCK',
          reason: 'PRICE_STOCK_EXPIRED',
          age_seconds: 600,
        });
        assert.deepEqual(publishingMetadata(blocked.payload).attribution, {
          product_id: 'product-stale',
          offer_id: 'offer-stale',
          snapshot_id: STALE_SNAPSHOT_ID,
          snapshot_captured_at: '2026-08-25T10:00:00.000Z',
        });
        assert.equal(publishingMetadata(blocked.payload).requested_mode, 'AUTO');
        assert.equal(publishingMetadata(blocked.payload).mode, undefined);

        await assert.rejects(
          publishing.recordAutoResult({
            publicationId: STALE_PUBLICATION_ID,
            platform: 'VK_COMMUNITY',
            outcome: 'SUCCESS',
            code: 'VK_POST_CREATED',
            externalId: 'wall-1_1',
            publishedAt: '2026-08-25T10:10:00.000Z',
          }),
          PublishingStateConflictError,
        );
      },
    );

    await t.test(
      'ASSISTED packet derives publication and attribution IDs from canonical state',
      async () => {
        await publishing.recordQaResult({
          publicationId: ASSISTED_PUBLICATION_ID,
          platform: 'VK_COMMUNITY',
          outcome: 'PASS',
          evidenceId: 'qa-assisted-001',
          code: 'QA_PASSED',
        });
        await publishing.requestApproval({
          publicationId: ASSISTED_PUBLICATION_ID,
          platform: 'VK_COMMUNITY',
          approvalId: ASSISTED_APPROVAL_ID,
          requestedBy: 'owner',
        });
        await publishing.decideApproval({
          publicationId: ASSISTED_PUBLICATION_ID,
          platform: 'VK_COMMUNITY',
          approvalId: ASSISTED_APPROVAL_ID,
          decision: 'APPROVED',
          decidedBy: 'owner',
        });

        const assisted = await publishing.applyPreparation({
          publicationId: ASSISTED_PUBLICATION_ID,
          platform: 'VK_COMMUNITY',
          mode: 'ASSISTED',
          snapshotId: ASSISTED_SNAPSHOT_ID,
        });

        assert.equal(assisted.status, 'ASSISTED');
        assert.equal(assisted.publishedAt, null);
        assert.deepEqual(publishingMetadata(assisted.payload).assisted_packet, {
          publication_id: ASSISTED_PUBLICATION_ID,
          master_content_id: MASTER_CONTENT_ID,
          workspace_id: 'yastroyka-vk-community',
          platform: 'VK_COMMUNITY',
          product_id: 'product-assisted',
          offer_id: 'offer-assisted',
          snapshot_id: ASSISTED_SNAPSHOT_ID,
          snapshot_captured_at: '2026-08-25T10:09:30.000Z',
        });
      },
    );

    await t.test(
      'AUTO requires the full gate chain before a publish result can persist',
      async () => {
        await publishing.recordQaResult({
          publicationId: AUTO_PUBLICATION_ID,
          platform: 'VK_COMMUNITY',
          outcome: 'PASS',
          evidenceId: 'qa-auto-001',
          code: 'QA_PASSED',
        });
        await publishing.requestApproval({
          publicationId: AUTO_PUBLICATION_ID,
          platform: 'VK_COMMUNITY',
          approvalId: AUTO_APPROVAL_ID,
          requestedBy: 'owner',
        });
        await publishing.decideApproval({
          publicationId: AUTO_PUBLICATION_ID,
          platform: 'VK_COMMUNITY',
          approvalId: AUTO_APPROVAL_ID,
          decision: 'APPROVED',
          decidedBy: 'owner',
        });

        const auto = await publishing.applyPreparation({
          publicationId: AUTO_PUBLICATION_ID,
          platform: 'VK_COMMUNITY',
          mode: 'AUTO',
          snapshotId: AUTO_SNAPSHOT_ID,
        });
        assert.equal(auto.status, 'AUTO');
        assert.deepEqual(publishingMetadata(auto.payload).freshness, {
          status: 'FRESH',
          reason: 'PRICE_STOCK_FRESH',
          age_seconds: 10,
        });

        const published = await publishing.recordAutoResult({
          publicationId: AUTO_PUBLICATION_ID,
          platform: 'VK_COMMUNITY',
          outcome: 'SUCCESS',
          code: 'VK_POST_CREATED',
          externalId: 'wall-123_456',
          publishedAt: '2026-08-25T10:10:00.000Z',
        });
        assert.equal(published.status, 'PUBLISHED');
        assert.equal(published.publishedAt, '2026-08-25T10:10:00.000Z');
        assert.deepEqual(publishingMetadata(published.payload).result, {
          outcome: 'SUCCESS',
          code: 'VK_POST_CREATED',
          external_id: 'wall-123_456',
        });
      },
    );

    await t.test('rejected human approval is terminal for this publication attempt', async () => {
      await publishing.recordQaResult({
        publicationId: REJECTED_PUBLICATION_ID,
        platform: 'VK_COMMUNITY',
        outcome: 'PASS',
        evidenceId: 'qa-rejected-001',
        code: 'QA_PASSED',
      });
      await publishing.requestApproval({
        publicationId: REJECTED_PUBLICATION_ID,
        platform: 'VK_COMMUNITY',
        approvalId: REJECTED_APPROVAL_ID,
        requestedBy: 'owner',
      });
      const rejected = await publishing.decideApproval({
        publicationId: REJECTED_PUBLICATION_ID,
        platform: 'VK_COMMUNITY',
        approvalId: REJECTED_APPROVAL_ID,
        decision: 'REJECTED',
        decidedBy: 'owner',
        reasonCode: 'OWNER_REJECTED',
      });
      assert.equal(rejected.status, 'REJECTED');

      await assert.rejects(
        publishing.applyPreparation({
          publicationId: REJECTED_PUBLICATION_ID,
          platform: 'VK_COMMUNITY',
          mode: 'ASSISTED',
          snapshotId: ASSISTED_SNAPSHOT_ID,
        }),
        PublishingStateConflictError,
      );

      const [approvalRows] = await database.query(
        `
          SELECT status, reason
          FROM approvals
          WHERE id = '${REJECTED_APPROVAL_ID}';
        `,
      );
      assert.deepEqual(approvalRows[0], {
        status: 'REJECTED',
        reason: 'OWNER_REJECTED',
      });
    });
  } finally {
    await database
      .query(
        `DELETE FROM approvals WHERE aggregate_id IN (${PUBLICATION_IDS.map((id) => `'${id}'`).join(', ')});`,
      )
      .catch(() => undefined);
    await database
      .query(`DELETE FROM publications WHERE master_content_id = '${MASTER_CONTENT_ID}';`)
      .catch(() => undefined);
    await database
      .query(
        `DELETE FROM commerce_offer_snapshots WHERE id IN (${SNAPSHOT_IDS.map((id) => `'${id}'`).join(', ')});`,
      )
      .catch(() => undefined);
    await database.close();
  }
});
