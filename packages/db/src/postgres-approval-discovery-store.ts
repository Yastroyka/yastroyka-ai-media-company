import type { Sequelize } from 'sequelize';

export interface PendingApprovalSummary {
  readonly waitingCount: number;
  readonly oldestWaitingAt: string | null;
}

function normalizeWaitingCount(value: unknown): number {
  const count = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Approval summary contains an invalid waiting count.');
  }

  return count;
}

function normalizeTimestamp(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (date === null || Number.isNaN(date.getTime())) {
    throw new Error('Approval summary contains an invalid oldest waiting timestamp.');
  }

  return date.toISOString();
}

export class PostgresApprovalDiscoveryStore {
  readonly #database: Sequelize;

  constructor(database: Sequelize) {
    this.#database = database;
  }

  async getPendingSummary(): Promise<PendingApprovalSummary> {
    const [rows] = await this.#database.query(`
      SELECT
        COUNT(*) AS waiting_count,
        MIN(created_at) AS oldest_waiting_at
      FROM approvals
      WHERE status = 'PENDING';
    `);

    const row = rows[0] as
      | {
          waiting_count?: unknown;
          oldest_waiting_at?: unknown;
        }
      | undefined;

    if (row?.waiting_count === undefined || row.oldest_waiting_at === undefined) {
      throw new Error('Approval summary query returned an invalid result.');
    }

    const waitingCount = normalizeWaitingCount(row.waiting_count);
    const oldestWaitingAt = normalizeTimestamp(row.oldest_waiting_at);

    if ((waitingCount === 0) !== (oldestWaitingAt === null)) {
      throw new Error('Approval summary is internally inconsistent.');
    }

    return {
      waitingCount,
      oldestWaitingAt,
    };
  }
}

export function createPostgresApprovalDiscoveryStore(
  database: Sequelize,
): PostgresApprovalDiscoveryStore {
  return new PostgresApprovalDiscoveryStore(database);
}
