import {
  PostgresPlatformWorkspaceStore,
  PostgresPublicationDiscoveryStore,
  createReadOnlyDatabaseConnection,
} from '@yastroyka/db';
import type { VkCommunityPublicationStatePort } from '@yastroyka/orchestrator';

export interface VkCommunityReadOnlyPublicationStateLease {
  readonly publicationState: VkCommunityPublicationStatePort;
  readonly close: () => Promise<void>;
}

export interface VkCommunityReadOnlyPublicationDiscoveryLease {
  readonly publicationDiscovery: Pick<PostgresPublicationDiscoveryStore, 'listRecentByPlatform'>;
  readonly close: () => Promise<void>;
}

async function openReadOnlyDatabase() {
  const database = createReadOnlyDatabaseConnection();

  try {
    await database.authenticate();
    return database;
  } catch {
    try {
      await database.close();
    } catch {
      // Keep connection failures sanitized by the caller.
    }
    throw new Error('VK read-only PostgreSQL state unavailable');
  }
}

export async function openPostgresVkCommunityReadOnlyState(): Promise<VkCommunityReadOnlyPublicationStateLease> {
  const database = await openReadOnlyDatabase();

  return {
    publicationState: new PostgresPlatformWorkspaceStore(database),
    async close() {
      await database.close();
    },
  };
}

export async function openPostgresVkCommunityPublicationDiscovery(): Promise<VkCommunityReadOnlyPublicationDiscoveryLease> {
  const database = await openReadOnlyDatabase();

  return {
    publicationDiscovery: new PostgresPublicationDiscoveryStore(database),
    async close() {
      await database.close();
    },
  };
}
