import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRoutingDecisionTrace,
  type CapabilityRecord,
} from '@yastroyka/model-exchange';

const TEST_DATABASE_HOST = '127.0.0.1';
const TEST_DATABASE_NAME = 'yastroyka_r1_test';
const OLDER_RUN_ID = 'task-028-engineering-run-older';
const LATEST_RUN_ID = 'task-028-engineering-run-latest';
const ROUTING_REQUEST_PREFIX = 'task028-routing-';
const ROUTING_VERIFIED_AT = '2026-09-10T11:00:00.000Z';

process.env.YASTROYKA_DB_HOST = TEST_DATABASE_HOST;
process.env.YASTROYKA_DB_NAME = TEST_DATABASE_NAME;

const { createDatabaseConnection } = await import('../src/connection.ts');
const { createMigrator } = await import('../src/migrator.ts');
const { createPostgresEngineeringEvidenceStore } =
  await import('../src/postgres-engineering-evidence-store.ts');
const { createPostgresDecisionTraceStore } =
  await import('../src/postgres-model-exchange-store.ts');

function engineeringEvidence(runId: string, sequence: number, recordedAt: string, status: string) {
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

function routingCapability(modelId: string, score: number): CapabilityRecord {
  return {
    model_id: modelId,
    provider: `provider-${modelId}`,
    revision: 'r1',
    task_classes: ['TEXT_GENERATION'],
    scores: { MAX_QUALITY: score },
    lifecycle: 'PRODUCTION',
    verified_at: ROUTING_VERIFIED_AT,
  };
}

function routingTrace(requestId: string, decisionId: string, createdAt: string) {
  return createRoutingDecisionTrace(
    {
      request_id: requestId,
      task_class: 'TEXT_GENERATION',
      mode: 'MAX_QUALITY',
      requirements: {},
    },
    [
      routingCapability('task028-routing-model-a', 0.91),
      routingCapability('task028-routing-model-b', 0.82),
    ],
    {
      createDecisionId: () => decisionId,
      now: () => new Date(createdAt),
    },
  );
}

test('TASK-028 discovers the latest engineering evidence deterministically', async (t) => {
  const database = createDatabaseConnection();

  try {
    const migrator = createMigrator(database);
    await migrator.up();
    await database.query(
      `DELETE FROM engineering_run_evidence WHERE run_id LIKE 'task-028-engineering-run-%';`,
    );

    await t.test('global latest lookup has a dedicated deterministic index', async () => {
      const [indexes] = await database.query(`
        SELECT indexdef
        FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'engineering_run_evidence'
          AND indexname = 'idx_engineering_run_evidence_latest';
      `);

      assert.equal(indexes.length, 1);
      assert.match(
        String((indexes[0] as { indexdef?: unknown }).indexdef),
        /\(recorded_at DESC, sequence DESC, run_id DESC\)/u,
      );
    });

    const store = createPostgresEngineeringEvidenceStore(database);

    await store.record(
      engineeringEvidence(OLDER_RUN_ID, 1, '2026-09-10T12:00:00.000Z', 'approved'),
    );
    await store.record(
      engineeringEvidence(LATEST_RUN_ID, 1, '2026-09-10T13:00:00.000Z', 'approved'),
    );
    await store.record(
      engineeringEvidence(LATEST_RUN_ID, 2, '2026-09-10T13:00:00.000Z', 'ready_for_owner_decision'),
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

test('TASK-028 discovers the latest Model Exchange decision fail-closed', async (t) => {
  const database = createDatabaseConnection();

  try {
    const migrator = createMigrator(database);
    await migrator.up();
    await database.query(`DELETE FROM routing_decisions WHERE request_id LIKE '${ROUTING_REQUEST_PREFIX}%';`);

    const store = createPostgresDecisionTraceStore(database);

    await store.record(
      routingTrace(
        `${ROUTING_REQUEST_PREFIX}older`,
        '00000000-0000-4000-8000-000000000281',
        '2026-09-10T12:00:00.000Z',
      ),
    );
    await store.record(
      routingTrace(
        `${ROUTING_REQUEST_PREFIX}tie-a`,
        '00000000-0000-4000-8000-000000000282',
        '2026-09-10T13:00:00.000Z',
      ),
    );
    await store.record(
      routingTrace(
        `${ROUTING_REQUEST_PREFIX}tie-b`,
        '00000000-0000-4000-8000-000000000283',
        '2026-09-10T13:00:00.000Z',
      ),
    );

    await t.test('newest decision uses request id as a deterministic timestamp tie-break', async () => {
      const latest = await store.findLatest();

      assert.notEqual(latest, null);
      assert.equal(latest?.request_id, `${ROUTING_REQUEST_PREFIX}tie-b`);
      assert.equal(latest?.decision_id, '00000000-0000-4000-8000-000000000283');
      assert.equal(latest?.winner.model_id, 'task028-routing-model-a');
    });

    await t.test('malformed persisted latest decision fails closed through canonical parsing', async () => {
      await database.query(
        `
          UPDATE routing_decisions
          SET payload = CAST('{"invalid":true}' AS jsonb),
              created_at = TIMESTAMPTZ '2026-09-10T14:00:00.000Z'
          WHERE request_id = '${ROUTING_REQUEST_PREFIX}older';
        `,
      );

      await assert.rejects(store.findLatest());
    });

    await t.test('empty routing decisions return null instead of inventing a decision', async () => {
      await database.query(
        `DELETE FROM routing_decisions WHERE request_id LIKE '${ROUTING_REQUEST_PREFIX}%';`,
      );
      assert.equal(await store.findLatest(), null);
    });
  } finally {
    await database
      .query(`DELETE FROM routing_decisions WHERE request_id LIKE '${ROUTING_REQUEST_PREFIX}%';`)
      .catch(() => undefined);
    await database.close();
  }
});
