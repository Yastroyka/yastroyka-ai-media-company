import assert from 'node:assert/strict';
import test from 'node:test';

const TEST_DATABASE_HOST = '127.0.0.1';
const TEST_DATABASE_NAME = 'yastroyka_r1_test';

const PROJECT_ID = '00000000-0000-4000-8000-000000001100';
const CAMPAIGN_ID = '00000000-0000-4000-8000-000000001101';
const PUBLICATION_ID = '00000000-0000-4000-8000-000000001102';
const DRAFT_PUBLICATION_ID = '00000000-0000-4000-8000-000000001103';
const MASTER_CONTENT_ID = '00000000-0000-4000-8000-000000001104';
const SESSION_ID = '00000000-0000-4000-8000-000000001105';
const CLICK_EARLY_ID = '00000000-0000-4000-8000-000000001106';
const CLICK_LATE_ID = '00000000-0000-4000-8000-000000001107';
const ORDER_LINE_ID = '00000000-0000-4000-8000-000000001108';
const SECOND_ORDER_LINE_ID = '00000000-0000-4000-8000-000000001109';
const UNMATCHED_ORDER_LINE_ID = '00000000-0000-4000-8000-00000000110a';

process.env.YASTROYKA_DB_HOST = TEST_DATABASE_HOST;
process.env.YASTROYKA_DB_NAME = TEST_DATABASE_NAME;

const { createDatabaseConnection } = await import('../src/connection.ts');
const { createMigrator } = await import('../src/migrator.ts');
const {
  ANALYTICS_ATTRIBUTION_MODEL,
  ANALYTICS_CAUSALITY,
  AnalyticsAttributionConflictError,
  AnalyticsAttributionNotFoundError,
  createPostgresAnalyticsAttributionStore,
} = await import('../src/postgres-analytics-attribution-store.ts');

async function cleanup(database: ReturnType<typeof createDatabaseConnection>): Promise<void> {
  await database.query(
    `DELETE FROM analytics_attributions WHERE order_line_id IN (:orderLineIds);`,
    {
      replacements: {
        orderLineIds: [ORDER_LINE_ID, SECOND_ORDER_LINE_ID, UNMATCHED_ORDER_LINE_ID],
      },
    },
  );
  await database.query(`DELETE FROM analytics_order_lines WHERE session_id = :sessionId;`, {
    replacements: { sessionId: SESSION_ID },
  });
  await database.query(`DELETE FROM analytics_clicks WHERE session_id = :sessionId;`, {
    replacements: { sessionId: SESSION_ID },
  });
  await database.query(`DELETE FROM analytics_sessions WHERE id = :sessionId;`, {
    replacements: { sessionId: SESSION_ID },
  });
  await database.query(`DELETE FROM publications WHERE id IN (:publicationIds);`, {
    replacements: { publicationIds: [PUBLICATION_ID, DRAFT_PUBLICATION_ID] },
  });
  await database.query(`DELETE FROM campaigns WHERE id = :campaignId;`, {
    replacements: { campaignId: CAMPAIGN_ID },
  });
  await database.query(`DELETE FROM projects WHERE id = :projectId;`, {
    replacements: { projectId: PROJECT_ID },
  });
}

test('TASK-011 queries the tracked publication-to-order-line path without causal overclaim', async () => {
  const database = createDatabaseConnection();

  try {
    const [identityRows] = await database.query(`
      SELECT current_database() AS database, current_user AS username;
    `);
    const identity = identityRows[0] as { database: string; username: string };
    assert.equal(identity.database, TEST_DATABASE_NAME);

    const migrator = createMigrator(database);
    await migrator.up();
    await cleanup(database);

    await database.query(
      `
        INSERT INTO projects (id, code, name)
        VALUES (:projectId, 'task-011', 'TASK-011 Analytics');
      `,
      { replacements: { projectId: PROJECT_ID } },
    );
    await database.query(
      `
        INSERT INTO campaigns (id, project_id, objective, status)
        VALUES (:campaignId, :projectId, 'Track observed commerce path', 'ACTIVE');
      `,
      { replacements: { campaignId: CAMPAIGN_ID, projectId: PROJECT_ID } },
    );
    await database.query(
      `
        INSERT INTO publications (
          id, master_content_id, workspace_id, platform, status, payload, published_at
        )
        VALUES (
          :publicationId, :masterContentId, 'VK_COMMUNITY', 'VK_COMMUNITY', 'PUBLISHED',
          CAST(:payload AS JSONB), :publishedAt
        );
      `,
      {
        replacements: {
          publicationId: PUBLICATION_ID,
          masterContentId: MASTER_CONTENT_ID,
          payload: JSON.stringify({ message: 'tracked publication' }),
          publishedAt: '2026-09-01T09:59:00.000Z',
        },
      },
    );
    await database.query(
      `
        INSERT INTO publications (
          id, master_content_id, workspace_id, platform, status, payload
        )
        VALUES (
          :publicationId, :masterContentId, 'VK_COMMUNITY', 'VK_COMMUNITY', 'DRAFT',
          CAST(:payload AS JSONB)
        );
      `,
      {
        replacements: {
          publicationId: DRAFT_PUBLICATION_ID,
          masterContentId: MASTER_CONTENT_ID,
          payload: JSON.stringify({ message: 'draft publication' }),
        },
      },
    );

    const analytics = createPostgresAnalyticsAttributionStore(database);
    await analytics.createSession({
      sessionId: SESSION_ID,
      startedAt: '2026-09-01T10:00:00.000Z',
    });

    await assert.rejects(
      analytics.recordClick({
        clickId: '00000000-0000-4000-8000-00000000110b',
        sessionId: SESSION_ID,
        campaignId: CAMPAIGN_ID,
        publicationId: DRAFT_PUBLICATION_ID,
        productId: 'product-42',
        offerId: 'offer-42',
        clickedAt: '2026-09-01T10:00:30.000Z',
      }),
      AnalyticsAttributionConflictError,
    );

    await analytics.recordClick({
      clickId: CLICK_EARLY_ID,
      sessionId: SESSION_ID,
      campaignId: CAMPAIGN_ID,
      publicationId: PUBLICATION_ID,
      productId: 'product-42',
      offerId: 'offer-42',
      clickedAt: '2026-09-01T10:01:00.000Z',
    });
    await analytics.recordClick({
      clickId: CLICK_LATE_ID,
      sessionId: SESSION_ID,
      campaignId: CAMPAIGN_ID,
      publicationId: PUBLICATION_ID,
      productId: 'product-42',
      offerId: 'offer-42',
      clickedAt: '2026-09-01T10:02:00.000Z',
    });

    await analytics.recordOrderLine({
      orderLineId: ORDER_LINE_ID,
      sessionId: SESSION_ID,
      externalOrderId: 'order-9001',
      externalOrderLineId: 'order-9001-line-1',
      productId: 'product-42',
      offerId: 'offer-42',
      gmvMinor: 125_000,
      currency: 'RUB',
      orderedAt: '2026-09-01T10:03:00.000Z',
    });
    await analytics.recordOrderLine({
      orderLineId: SECOND_ORDER_LINE_ID,
      sessionId: SESSION_ID,
      externalOrderId: 'order-9001',
      externalOrderLineId: 'order-9001-line-2',
      productId: 'product-42',
      offerId: 'offer-42',
      gmvMinor: 50_000,
      currency: 'RUB',
      orderedAt: '2026-09-01T10:04:00.000Z',
    });
    await analytics.recordOrderLine({
      orderLineId: UNMATCHED_ORDER_LINE_ID,
      sessionId: SESSION_ID,
      externalOrderId: 'order-9002',
      externalOrderLineId: 'order-9002-line-1',
      productId: 'product-other',
      offerId: 'offer-other',
      gmvMinor: 1_000,
      currency: 'RUB',
      orderedAt: '2026-09-01T10:05:00.000Z',
    });

    const firstAssignment = await analytics.attributeLastTrackedClick(ORDER_LINE_ID);
    assert.deepEqual(firstAssignment, {
      orderLineId: ORDER_LINE_ID,
      clickId: CLICK_LATE_ID,
      attributionModel: ANALYTICS_ATTRIBUTION_MODEL,
      causality: ANALYTICS_CAUSALITY,
    });
    const replayAssignment = await analytics.attributeLastTrackedClick(ORDER_LINE_ID);
    assert.deepEqual(replayAssignment, firstAssignment);

    const secondAssignment = await analytics.attributeLastTrackedClick(SECOND_ORDER_LINE_ID);
    assert.equal(secondAssignment.clickId, CLICK_LATE_ID);

    await assert.rejects(
      analytics.attributeLastTrackedClick(UNMATCHED_ORDER_LINE_ID),
      AnalyticsAttributionNotFoundError,
    );

    const report = await analytics.queryPublicationAttribution(PUBLICATION_ID);
    assert.equal(report.publicationId, PUBLICATION_ID);
    assert.equal(report.causality, ANALYTICS_CAUSALITY);
    assert.deepEqual(report.gmvByCurrency, { RUB: '175000' });
    assert.equal(report.paths.length, 2);

    for (const path of report.paths) {
      assert.equal(path.productId, 'product-42');
      assert.equal(path.offerId, 'offer-42');
      assert.equal(path.masterContentId, MASTER_CONTENT_ID);
      assert.equal(path.campaignId, CAMPAIGN_ID);
      assert.equal(path.publicationId, PUBLICATION_ID);
      assert.equal(path.clickId, CLICK_LATE_ID);
      assert.equal(path.sessionId, SESSION_ID);
      assert.equal(path.attributionModel, ANALYTICS_ATTRIBUTION_MODEL);
      assert.equal(path.causality, ANALYTICS_CAUSALITY);
    }

    const [attributionRows] = await database.query(
      `
        SELECT attribution_model, causality_claim
        FROM analytics_attributions
        WHERE order_line_id = :orderLineId;
      `,
      { replacements: { orderLineId: ORDER_LINE_ID } },
    );
    assert.deepEqual(attributionRows, [
      {
        attribution_model: 'LAST_TRACKED_CLICK',
        causality_claim: false,
      },
    ]);

    await cleanup(database);
    await migrator.down({ to: '0005-analytics-attribution' });
    const [tableRowsAfterDown] = await database.query(
      `SELECT to_regclass('public.analytics_attributions') AS attribution_table;`,
    );
    assert.deepEqual(tableRowsAfterDown, [{ attribution_table: null }]);
    await migrator.up();
  } finally {
    await database.close();
  }
});
