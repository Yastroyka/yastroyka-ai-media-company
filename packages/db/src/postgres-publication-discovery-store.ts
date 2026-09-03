import { QueryTypes, type Sequelize } from 'sequelize';

import {
  PUBLICATION_PLATFORMS,
  PUBLICATION_STATUSES,
  type PlatformPublicationStatus,
  type PublicationPlatform,
} from './postgres-platform-workspace-store.ts';

export interface PublicationDiscoveryRecord {
  readonly publicationId: string;
  readonly masterContentId: string;
  readonly workspaceId: string;
  readonly platform: PublicationPlatform;
  readonly status: PlatformPublicationStatus;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

interface PublicationDiscoveryRow {
  readonly id: string;
  readonly master_content_id: string;
  readonly workspace_id: string;
  readonly platform: string;
  readonly status: string;
  readonly created_at: Date | string;
  readonly published_at: Date | string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_DISCOVERY_LIMIT = 50;

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
  if (!(PUBLICATION_STATUSES as readonly string[]).includes(value)) {
    throw new Error('Unsupported publication status.');
  }
}

function requireLimit(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_DISCOVERY_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_DISCOVERY_LIMIT}.`);
  }
}

function normalizeDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Publication row contains an invalid date.');
  }
  return date.toISOString();
}

function normalizeRow(row: PublicationDiscoveryRow): PublicationDiscoveryRecord {
  requireUuid(row.id, 'publicationId');
  requireUuid(row.master_content_id, 'masterContentId');
  requireWorkspaceId(row.workspace_id);
  requirePlatform(row.platform);
  requireStatus(row.status);

  return {
    publicationId: row.id,
    masterContentId: row.master_content_id,
    workspaceId: row.workspace_id,
    platform: row.platform,
    status: row.status,
    createdAt: normalizeDate(row.created_at),
    publishedAt: row.published_at === null ? null : normalizeDate(row.published_at),
  };
}

export class PostgresPublicationDiscoveryStore {
  readonly #database: Sequelize;

  constructor(database: Sequelize) {
    this.#database = database;
  }

  async listRecentByPlatform(
    platform: PublicationPlatform,
    limit = 20,
  ): Promise<readonly PublicationDiscoveryRecord[]> {
    requirePlatform(platform);
    requireLimit(limit);

    const rows = await this.#database.query<PublicationDiscoveryRow>(
      `
        SELECT
          id,
          master_content_id,
          workspace_id,
          platform,
          status,
          created_at,
          published_at
        FROM publications
        WHERE platform = :platform
        ORDER BY created_at DESC, id DESC
        LIMIT :limit;
      `,
      {
        replacements: { platform, limit },
        type: QueryTypes.SELECT,
      },
    );

    return rows.map(normalizeRow);
  }
}

export function createPostgresPublicationDiscoveryStore(
  database: Sequelize,
): PostgresPublicationDiscoveryStore {
  return new PostgresPublicationDiscoveryStore(database);
}
