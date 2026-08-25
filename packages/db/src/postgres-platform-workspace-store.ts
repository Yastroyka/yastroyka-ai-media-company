import { QueryTypes, type Sequelize } from 'sequelize';

export const PUBLICATION_PLATFORMS = ['VK_COMMUNITY', 'VK_VIDEO', 'MAX'] as const;

export type PublicationPlatform = (typeof PUBLICATION_PLATFORMS)[number];
export type PlatformPublicationStatus = 'DRAFT' | 'FAILED';

export interface CreatePlatformPublicationDraftInput {
  readonly publicationId: string;
  readonly masterContentId: string;
  readonly workspaceId: string;
  readonly platform: PublicationPlatform;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PlatformPublicationRecord {
  readonly publicationId: string;
  readonly masterContentId: string;
  readonly workspaceId: string;
  readonly platform: PublicationPlatform;
  readonly status: PlatformPublicationStatus;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

interface PublicationRow {
  readonly id: string;
  readonly master_content_id: string;
  readonly workspace_id: string;
  readonly platform: string;
  readonly status: string;
  readonly payload: unknown;
  readonly created_at: Date | string;
  readonly published_at: Date | string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,79}$/u;
const SENSITIVE_KEY_PATTERN = /(secret|token|password|credential|api[_-]?key)/iu;

export class PlatformPublicationStateConflictError extends Error {
  constructor() {
    super('Platform publication state transition conflict.');
    this.name = 'PlatformPublicationStateConflictError';
  }
}

function requireUuid(value: string, fieldName: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be a UUID.`);
  }
}

function requireWorkspaceId(value: string): void {
  if (!WORKSPACE_ID_PATTERN.test(value)) {
    throw new Error('workspaceId must be a safe identifier no longer than 128 characters.');
  }
}

function requirePlatform(value: string): asserts value is PublicationPlatform {
  if (!(PUBLICATION_PLATFORMS as readonly string[]).includes(value)) {
    throw new Error('Unsupported publication platform.');
  }
}

function requireStatus(value: string): asserts value is PlatformPublicationStatus {
  if (value !== 'DRAFT' && value !== 'FAILED') {
    throw new Error('Unsupported TASK-009 publication status.');
  }
}

function assertPayloadSafe(value: unknown, path = 'payload'): void {
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
    value.forEach((item, index) => assertPayloadSafe(item, `${path}[${index}]`));
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
      throw new Error('Publication payload must not contain credentials or secret material.');
    }
    assertPayloadSafe(nested, `${path}.${key}`);
  }
}

function normalizeDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Publication row contains an invalid date.');
  }
  return date.toISOString();
}

function normalizeRow(row: PublicationRow): PlatformPublicationRecord {
  requireUuid(row.id, 'publicationId');
  requireUuid(row.master_content_id, 'masterContentId');
  requireWorkspaceId(row.workspace_id);
  requirePlatform(row.platform);
  requireStatus(row.status);
  assertPayloadSafe(row.payload);

  if (row.payload === null || Array.isArray(row.payload) || typeof row.payload !== 'object') {
    throw new Error('Publication payload must be a JSON object.');
  }

  return {
    publicationId: row.id,
    masterContentId: row.master_content_id,
    workspaceId: row.workspace_id,
    platform: row.platform,
    status: row.status,
    payload: row.payload as Readonly<Record<string, unknown>>,
    createdAt: normalizeDate(row.created_at),
    publishedAt: row.published_at === null ? null : normalizeDate(row.published_at),
  };
}

export class PostgresPlatformWorkspaceStore {
  readonly #database: Sequelize;

  constructor(database: Sequelize) {
    this.#database = database;
  }

  async createDraft(input: CreatePlatformPublicationDraftInput): Promise<PlatformPublicationRecord> {
    requireUuid(input.publicationId, 'publicationId');
    requireUuid(input.masterContentId, 'masterContentId');
    requireWorkspaceId(input.workspaceId);
    requirePlatform(input.platform);
    assertPayloadSafe(input.payload);

    const rows = await this.#database.query<PublicationRow>(
      `
        INSERT INTO publications (
          id,
          master_content_id,
          workspace_id,
          platform,
          status,
          payload
        )
        VALUES (
          :publicationId,
          :masterContentId,
          :workspaceId,
          :platform,
          'DRAFT',
          CAST(:payload AS jsonb)
        )
        RETURNING
          id,
          master_content_id,
          workspace_id,
          platform,
          status,
          payload,
          created_at,
          published_at;
      `,
      {
        replacements: {
          publicationId: input.publicationId,
          masterContentId: input.masterContentId,
          workspaceId: input.workspaceId,
          platform: input.platform,
          payload: JSON.stringify(input.payload),
        },
        type: QueryTypes.SELECT,
      },
    );

    const row = rows[0];
    if (row === undefined) {
      throw new Error('Platform publication draft was not persisted.');
    }
    return normalizeRow(row);
  }

  async markFailed(
    publicationId: string,
    platform: PublicationPlatform,
    failureCode: string,
  ): Promise<PlatformPublicationRecord> {
    requireUuid(publicationId, 'publicationId');
    requirePlatform(platform);
    if (!FAILURE_CODE_PATTERN.test(failureCode)) {
      throw new Error('failureCode must be a safe uppercase identifier.');
    }

    const rows = await this.#database.query<PublicationRow>(
      `
        UPDATE publications
        SET
          status = 'FAILED',
          payload = payload || CAST(:failureMetadata AS jsonb)
        WHERE id = :publicationId
          AND platform = :platform
          AND status = 'DRAFT'
        RETURNING
          id,
          master_content_id,
          workspace_id,
          platform,
          status,
          payload,
          created_at,
          published_at;
      `,
      {
        replacements: {
          publicationId,
          platform,
          failureMetadata: JSON.stringify({ failure_code: failureCode }),
        },
        type: QueryTypes.SELECT,
      },
    );

    const row = rows[0];
    if (row === undefined) {
      throw new PlatformPublicationStateConflictError();
    }
    return normalizeRow(row);
  }

  async findById(publicationId: string): Promise<PlatformPublicationRecord | null> {
    requireUuid(publicationId, 'publicationId');
    const rows = await this.#database.query<PublicationRow>(
      `
        SELECT
          id,
          master_content_id,
          workspace_id,
          platform,
          status,
          payload,
          created_at,
          published_at
        FROM publications
        WHERE id = :publicationId;
      `,
      {
        replacements: { publicationId },
        type: QueryTypes.SELECT,
      },
    );
    return rows[0] === undefined ? null : normalizeRow(rows[0]);
  }

  async listByMasterContent(masterContentId: string): Promise<readonly PlatformPublicationRecord[]> {
    requireUuid(masterContentId, 'masterContentId');
    const rows = await this.#database.query<PublicationRow>(
      `
        SELECT
          id,
          master_content_id,
          workspace_id,
          platform,
          status,
          payload,
          created_at,
          published_at
        FROM publications
        WHERE master_content_id = :masterContentId
        ORDER BY platform, id;
      `,
      {
        replacements: { masterContentId },
        type: QueryTypes.SELECT,
      },
    );
    return rows.map(normalizeRow);
  }
}

export function createPostgresPlatformWorkspaceStore(
  database: Sequelize,
): PostgresPlatformWorkspaceStore {
  return new PostgresPlatformWorkspaceStore(database);
}
