import {
  parseCapabilityRecord,
  parseRoutingDecisionTrace,
  type CapabilityRecord,
  type CapabilityRegistry,
  type DecisionTraceStore,
  type RoutingDecisionTrace,
} from '@yastroyka/model-exchange';
import type { Sequelize, Transaction } from 'sequelize';

export class RoutingDecisionConflictError extends Error {
  readonly request_id: string;

  constructor(requestId: string) {
    super('request_id is already associated with a different routing outcome.');
    this.name = 'RoutingDecisionConflictError';
    this.request_id = requestId;
  }
}

function serializeJson(value: unknown, field: string): string {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new Error(`${field} could not be serialized.`);
  }

  return serialized;
}

function parseJsonPayload(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  return JSON.parse(value) as unknown;
}

function traceOutcomeFingerprint(trace: RoutingDecisionTrace): string {
  return serializeJson(
    {
      request: trace.request,
      winner: trace.winner,
      fallbacks: trace.fallbacks,
      why_this_model: trace.why_this_model,
      confidence: trace.confidence,
      selected_score: trace.selected_score,
      candidates: trace.candidates,
    },
    'routing outcome',
  );
}

async function readTrace(
  database: Sequelize,
  requestId: string,
  transaction?: Transaction,
): Promise<RoutingDecisionTrace | null> {
  const [rows] = await database.query(
    `
      SELECT payload
      FROM routing_decisions
      WHERE request_id = $requestId;
    `,
    {
      bind: { requestId },
      ...(transaction === undefined ? {} : { transaction }),
    },
  );

  const row = rows[0] as { payload?: unknown } | undefined;

  if (row?.payload === undefined) {
    return null;
  }

  return parseRoutingDecisionTrace(parseJsonPayload(row.payload));
}

export class PostgresDecisionTraceStore implements DecisionTraceStore {
  readonly #database: Sequelize;

  constructor(database: Sequelize) {
    this.#database = database;
  }

  async record(traceValue: RoutingDecisionTrace): Promise<RoutingDecisionTrace> {
    const trace = parseRoutingDecisionTrace(traceValue);
    const payload = serializeJson(trace, 'routing decision trace');

    return this.#database.transaction(async (transaction) => {
      await this.#database.query(
        `
          INSERT INTO routing_decisions (
            id,
            request_id,
            task_class,
            policy_mode,
            winner_model_id,
            payload,
            created_at
          )
          VALUES (
            $decisionId,
            $requestId,
            $taskClass,
            $mode,
            $winnerModelId,
            CAST($payload AS jsonb),
            $createdAt
          )
          ON CONFLICT (request_id) DO NOTHING;
        `,
        {
          bind: {
            decisionId: trace.decision_id,
            requestId: trace.request_id,
            taskClass: trace.task_class,
            mode: trace.mode,
            winnerModelId: trace.winner.model_id,
            payload,
            createdAt: trace.created_at,
          },
          transaction,
        },
      );

      const persisted = await readTrace(this.#database, trace.request_id, transaction);

      if (persisted === null) {
        throw new Error('Routing decision trace was not persisted.');
      }

      if (traceOutcomeFingerprint(persisted) !== traceOutcomeFingerprint(trace)) {
        throw new RoutingDecisionConflictError(trace.request_id);
      }

      return persisted;
    });
  }

  async findByRequestId(requestId: string): Promise<RoutingDecisionTrace | null> {
    if (requestId.length === 0 || requestId.length > 256) {
      throw new Error('requestId must be a non-empty identifier.');
    }

    return readTrace(this.#database, requestId);
  }
}

export class PostgresCapabilityRegistry implements CapabilityRegistry {
  readonly #database: Sequelize;

  constructor(database: Sequelize) {
    this.#database = database;
  }

  async upsert(value: unknown): Promise<CapabilityRecord> {
    const capability = parseCapabilityRecord(value);

    await this.#database.query(
      `
        INSERT INTO model_capabilities (
          model_id,
          provider,
          revision,
          task_classes,
          scores,
          lifecycle,
          verified_at
        )
        VALUES (
          $modelId,
          $provider,
          $revision,
          CAST($taskClasses AS jsonb),
          CAST($scores AS jsonb),
          $lifecycle,
          $verifiedAt
        )
        ON CONFLICT (model_id, provider, revision)
        DO UPDATE SET
          task_classes = EXCLUDED.task_classes,
          scores = EXCLUDED.scores,
          lifecycle = EXCLUDED.lifecycle,
          verified_at = EXCLUDED.verified_at,
          updated_at = now();
      `,
      {
        bind: {
          modelId: capability.model_id,
          provider: capability.provider,
          revision: capability.revision,
          taskClasses: serializeJson(capability.task_classes, 'task_classes'),
          scores: serializeJson(capability.scores, 'scores'),
          lifecycle: capability.lifecycle,
          verifiedAt: capability.verified_at,
        },
      },
    );

    return capability;
  }

  async list(): Promise<readonly CapabilityRecord[]> {
    const [rows] = await this.#database.query(`
      SELECT
        model_id,
        provider,
        revision,
        task_classes,
        scores,
        lifecycle,
        verified_at
      FROM model_capabilities
      ORDER BY model_id, provider, revision;
    `);

    return rows.map((row) => {
      const capability = row as {
        model_id: unknown;
        provider: unknown;
        revision: unknown;
        task_classes: unknown;
        scores: unknown;
        lifecycle: unknown;
        verified_at: unknown;
      };

      return parseCapabilityRecord({
        ...capability,
        task_classes: parseJsonPayload(capability.task_classes),
        scores: parseJsonPayload(capability.scores),
        verified_at:
          capability.verified_at instanceof Date
            ? capability.verified_at.toISOString()
            : capability.verified_at,
      });
    });
  }
}

export function createPostgresDecisionTraceStore(database: Sequelize): PostgresDecisionTraceStore {
  return new PostgresDecisionTraceStore(database);
}

export function createPostgresCapabilityRegistry(database: Sequelize): PostgresCapabilityRegistry {
  return new PostgresCapabilityRegistry(database);
}
