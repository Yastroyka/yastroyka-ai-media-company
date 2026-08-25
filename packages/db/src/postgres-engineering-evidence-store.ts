import type { Sequelize, Transaction } from 'sequelize';

export interface DurableEngineeringEvidenceRecord {
  readonly runId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly payload: unknown;
  readonly recordedAt: string;
}

export class EngineeringEvidenceConflictError extends Error {
  readonly runId: string;
  readonly sequence: number;

  constructor(runId: string, sequence: number) {
    super('Engineering evidence sequence is already associated with a different payload.');
    this.name = 'EngineeringEvidenceConflictError';
    this.runId = runId;
    this.sequence = sequence;
  }
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
const SENSITIVE_KEY_PATTERN = /(?:secret|token|password|credential|api[_-]?key)/iu;

function requireIdentifier(value: string, field: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${field} must be a safe non-empty identifier no longer than 256 characters.`);
  }
}

function requireSequence(sequence: number): void {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 1_000_000) {
    throw new Error('sequence must be an integer between 1 and 1000000.');
  }
}

function requireEventType(eventType: string): void {
  if (!EVENT_TYPE_PATTERN.test(eventType)) {
    throw new Error('eventType must be a safe lowercase event identifier.');
  }
}

function requireIsoTimestamp(value: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error('recordedAt must be an exact ISO-8601 timestamp.');
  }
}

function assertNoSensitiveKeys(value: unknown, path = 'payload'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveKeys(item, `${path}[${String(index)}]`));
    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new Error(`Sensitive evidence field is not allowed: ${path}.${key}.`);
    }
    assertNoSensitiveKeys(nested, `${path}.${key}`);
  }
}

function serializeJson(value: unknown): string {
  assertNoSensitiveKeys(value);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('Engineering evidence payload could not be serialized.');
  }
  return serialized;
}

function normalizeJson(value: unknown): unknown {
  return JSON.parse(serializeJson(value)) as unknown;
}

function parseJsonPayload(value: unknown): unknown {
  return typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item));
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, nested]) => [key, canonicalizeJson(nested)]),
  );
}

function validateRecord(
  record: DurableEngineeringEvidenceRecord,
): DurableEngineeringEvidenceRecord {
  requireIdentifier(record.runId, 'runId');
  requireSequence(record.sequence);
  requireEventType(record.eventType);
  requireIsoTimestamp(record.recordedAt);

  return {
    runId: record.runId,
    sequence: record.sequence,
    eventType: record.eventType,
    payload: normalizeJson(record.payload),
    recordedAt: record.recordedAt,
  };
}

function fingerprint(record: DurableEngineeringEvidenceRecord): string {
  return JSON.stringify(
    canonicalizeJson({
      eventType: record.eventType,
      payload: record.payload,
      recordedAt: record.recordedAt,
    }),
  );
}

async function readEntry(
  database: Sequelize,
  runId: string,
  sequence: number,
  transaction?: Transaction,
): Promise<DurableEngineeringEvidenceRecord | null> {
  const [rows] = await database.query(
    `
      SELECT run_id, sequence, event_type, payload, recorded_at
      FROM engineering_run_evidence
      WHERE run_id = $runId
        AND sequence = $sequence;
    `,
    {
      bind: { runId, sequence },
      ...(transaction === undefined ? {} : { transaction }),
    },
  );

  const row = rows[0] as
    | {
        run_id: unknown;
        sequence: unknown;
        event_type: unknown;
        payload: unknown;
        recorded_at: unknown;
      }
    | undefined;

  if (row === undefined) {
    return null;
  }

  return validateRecord({
    runId: String(row.run_id),
    sequence: Number(row.sequence),
    eventType: String(row.event_type),
    payload: parseJsonPayload(row.payload),
    recordedAt:
      row.recorded_at instanceof Date ? row.recorded_at.toISOString() : String(row.recorded_at),
  });
}

export class PostgresEngineeringEvidenceStore {
  readonly #database: Sequelize;

  constructor(database: Sequelize) {
    this.#database = database;
  }

  async record(recordValue: DurableEngineeringEvidenceRecord): Promise<void> {
    const record = validateRecord(recordValue);
    const payload = serializeJson(record.payload);

    await this.#database.transaction(async (transaction) => {
      await this.#database.query(
        `
          INSERT INTO engineering_run_evidence (
            run_id,
            sequence,
            event_type,
            payload,
            recorded_at
          )
          VALUES (
            $runId,
            $sequence,
            $eventType,
            CAST($payload AS jsonb),
            $recordedAt
          )
          ON CONFLICT (run_id, sequence) DO NOTHING;
        `,
        {
          bind: {
            runId: record.runId,
            sequence: record.sequence,
            eventType: record.eventType,
            payload,
            recordedAt: record.recordedAt,
          },
          transaction,
        },
      );

      const persisted = await readEntry(this.#database, record.runId, record.sequence, transaction);
      if (persisted === null) {
        throw new Error('Engineering evidence was not persisted.');
      }

      if (fingerprint(persisted) !== fingerprint(record)) {
        throw new EngineeringEvidenceConflictError(record.runId, record.sequence);
      }
    });
  }

  async findByRunId(runId: string): Promise<readonly DurableEngineeringEvidenceRecord[]> {
    requireIdentifier(runId, 'runId');

    const [rows] = await this.#database.query(
      `
        SELECT run_id, sequence, event_type, payload, recorded_at
        FROM engineering_run_evidence
        WHERE run_id = $runId
        ORDER BY sequence ASC;
      `,
      { bind: { runId } },
    );

    return rows.map((row) => {
      const evidence = row as {
        run_id: unknown;
        sequence: unknown;
        event_type: unknown;
        payload: unknown;
        recorded_at: unknown;
      };

      return validateRecord({
        runId: String(evidence.run_id),
        sequence: Number(evidence.sequence),
        eventType: String(evidence.event_type),
        payload: parseJsonPayload(evidence.payload),
        recordedAt:
          evidence.recorded_at instanceof Date
            ? evidence.recorded_at.toISOString()
            : String(evidence.recorded_at),
      });
    });
  }
}

export function createPostgresEngineeringEvidenceStore(
  database: Sequelize,
): PostgresEngineeringEvidenceStore {
  return new PostgresEngineeringEvidenceStore(database);
}
