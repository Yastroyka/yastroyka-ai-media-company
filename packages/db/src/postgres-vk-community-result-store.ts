import {
  authorizeAndAudit,
  type AuthorizationAuditSink,
  type PolicyContractV2,
} from '@yastroyka/auth';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';

import { PublishingAuthorizationDeniedError } from './postgres-publishing-store.ts';

export interface RecordVkCommunitySuccessInput {
  readonly publicationId: string;
  readonly actorId: string;
  readonly ownerId: number;
  readonly postId: number;
  readonly idempotencyKey: string;
  readonly publishedAt: string;
}

export interface VkCommunityPersistedResult {
  readonly publicationId: string;
  readonly platform: 'VK_COMMUNITY';
  readonly status: 'PUBLISHED';
  readonly ownerId: number;
  readonly postId: number;
  readonly idempotencyKey: string;
  readonly publishedAt: string;
}

export interface PostgresVkCommunityResultStoreOptions {
  readonly authorizationPolicy: PolicyContractV2;
  readonly authorizationAuditSink: AuthorizationAuditSink;
}

interface PublicationRow {
  readonly id: string;
  readonly platform: string;
  readonly status: string;
  readonly payload: unknown;
  readonly published_at: Date | string | null;
}

export class VkCommunityResultStateConflictError extends Error {
  constructor() {
    super('VK Community publication result state conflict.');
    this.name = 'VkCommunityResultStateConflictError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_ACTOR_PATTERN = /^[A-Za-z0-9@._:+-]{1,128}$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{64}$/u;
const SENSITIVE_KEY_PATTERN = /(secret|token|password|credential|api[_-]?key)/iu;

function requireUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error('publicationId must be a UUID.');
  }
}

function requireExactTimestamp(value: string): void {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error('publishedAt must be an exact ISO-8601 UTC timestamp.');
  }
}

function requireInput(input: RecordVkCommunitySuccessInput): void {
  requireUuid(input.publicationId);
  if (!SAFE_ACTOR_PATTERN.test(input.actorId)) {
    throw new Error('actorId must be a safe actor identifier.');
  }
  if (
    !Number.isSafeInteger(input.ownerId) ||
    input.ownerId >= 0 ||
    input.ownerId < -2_147_483_647 ||
    !Number.isSafeInteger(input.postId) ||
    input.postId < 1 ||
    !IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)
  ) {
    throw new Error('VK Community result evidence is invalid.');
  }
  requireExactTimestamp(input.publishedAt);
}

function assertJsonSafe(value: unknown, path = 'payload'): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object') {
    throw new Error(`${path} contains an unsupported value.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must contain plain JSON-compatible objects only.`);
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new Error('Publication result must not contain secret material.');
    }
    assertJsonSafe(nested, `${path}.${key}`);
  }
}

function requireJsonObject(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Publication payload must be a JSON object.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Publication payload must be a plain JSON object.');
  }
  assertJsonSafe(value);
  return value as Record<string, unknown>;
}

function normalizeDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Publication result contains an invalid date.');
  }
  return date.toISOString();
}

async function selectForUpdate(
  database: Sequelize,
  transaction: Transaction,
  publicationId: string,
): Promise<PublicationRow> {
  const rows = await database.query<PublicationRow>(
    `
      SELECT id, platform, status, payload, published_at
      FROM publications
      WHERE id = :publicationId
        AND platform = 'VK_COMMUNITY'
      FOR UPDATE;
    `,
    {
      replacements: { publicationId },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  const row = rows[0];
  if (row === undefined) {
    throw new VkCommunityResultStateConflictError();
  }
  return row;
}

function expectedPersistedResult(
  input: RecordVkCommunitySuccessInput,
): VkCommunityPersistedResult {
  return Object.freeze({
    publicationId: input.publicationId,
    platform: 'VK_COMMUNITY' as const,
    status: 'PUBLISHED' as const,
    ownerId: input.ownerId,
    postId: input.postId,
    idempotencyKey: input.idempotencyKey,
    publishedAt: input.publishedAt,
  });
}

function assertExistingResultMatches(
  row: PublicationRow,
  input: RecordVkCommunitySuccessInput,
): VkCommunityPersistedResult {
  if (row.status !== 'PUBLISHED' || row.published_at === null) {
    throw new VkCommunityResultStateConflictError();
  }
  const payload = requireJsonObject(row.payload);
  const publishing = requireJsonObject(payload.publishing);
  const result = requireJsonObject(publishing.result);
  const vk = requireJsonObject(result.vk);
  if (
    result.outcome !== 'SUCCESS' ||
    result.code !== 'VK_WALL_POST_PUBLISHED' ||
    result.external_id !== String(input.postId) ||
    vk.owner_id !== input.ownerId ||
    vk.post_id !== input.postId ||
    vk.guid !== input.idempotencyKey ||
    normalizeDate(row.published_at) !== input.publishedAt
  ) {
    throw new VkCommunityResultStateConflictError();
  }
  return expectedPersistedResult(input);
}

export class PostgresVkCommunityResultStore {
  readonly #database: Sequelize;
  readonly #authorizationPolicy: PolicyContractV2;
  readonly #authorizationAuditSink: AuthorizationAuditSink;

  constructor(database: Sequelize, options: PostgresVkCommunityResultStoreOptions) {
    this.#database = database;
    this.#authorizationPolicy = options.authorizationPolicy;
    this.#authorizationAuditSink = options.authorizationAuditSink;
  }

  async recordSuccess(input: RecordVkCommunitySuccessInput): Promise<VkCommunityPersistedResult> {
    requireInput(input);
    const authorization = await authorizeAndAudit(
      this.#authorizationPolicy,
      {
        actor_id: input.actorId,
        resource: 'publication',
        action: 'record_result',
      },
      this.#authorizationAuditSink,
    );
    if (!authorization.allowed) {
      throw new PublishingAuthorizationDeniedError();
    }

    return this.#database.transaction(async (transaction) => {
      const row = await selectForUpdate(this.#database, transaction, input.publicationId);
      if (row.status === 'PUBLISHED') {
        return assertExistingResultMatches(row, input);
      }
      if (row.status !== 'AUTO') {
        throw new VkCommunityResultStateConflictError();
      }

      const payload = requireJsonObject(row.payload);
      const existingPublishing =
        payload.publishing === undefined ? {} : requireJsonObject(payload.publishing);
      if (existingPublishing.result !== undefined) {
        throw new VkCommunityResultStateConflictError();
      }
      const nextPayload = {
        ...payload,
        publishing: {
          ...existingPublishing,
          result: {
            outcome: 'SUCCESS',
            code: 'VK_WALL_POST_PUBLISHED',
            external_id: String(input.postId),
            vk: {
              owner_id: input.ownerId,
              post_id: input.postId,
              guid: input.idempotencyKey,
            },
          },
        },
      };
      assertJsonSafe(nextPayload);

      const updated = await this.#database.query<PublicationRow>(
        `
          UPDATE publications
          SET
            status = 'PUBLISHED',
            payload = CAST(:payload AS jsonb),
            published_at = :publishedAt
          WHERE id = :publicationId
            AND platform = 'VK_COMMUNITY'
            AND status = 'AUTO'
          RETURNING id, platform, status, payload, published_at;
        `,
        {
          replacements: {
            payload: JSON.stringify(nextPayload),
            publishedAt: input.publishedAt,
            publicationId: input.publicationId,
          },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      if (updated[0] === undefined) {
        throw new VkCommunityResultStateConflictError();
      }
      return assertExistingResultMatches(updated[0], input);
    });
  }
}

export function createPostgresVkCommunityResultStore(
  database: Sequelize,
  options: PostgresVkCommunityResultStoreOptions,
): PostgresVkCommunityResultStore {
  return new PostgresVkCommunityResultStore(database, options);
}
