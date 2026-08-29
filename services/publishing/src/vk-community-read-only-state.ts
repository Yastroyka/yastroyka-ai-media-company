import { PostgresPlatformWorkspaceStore, createReadOnlyDatabaseConnection } from '@yastroyka/db';
import type { VkCommunityPublicationStatePort } from '@yastroyka/orchestrator';

export interface VkCommunityReadOnlyPublicationStateLease {
  readonly publicationState: VkCommunityPublicationStatePort;
  readonly close: () => Promise<void>;
}

export async function openPostgresVkCommunityReadOnlyState(): Promise<VkCommunityReadOnlyPublicationStateLease> {
  const database = createReadOnlyDatabaseConnection();

  try {
    await database.authenticate();
    return {
      publicationState: new PostgresPlatformWorkspaceStore(database),
      async close() {
        await database.close();
      },
    };
  } catch {
    try {
      await database.close();
    } catch {
      // Keep connection failures sanitized by the caller.
    }
    throw new Error('VK read-only PostgreSQL state unavailable');
  }
}
