import {
  VkCommunityPublishingError,
  type VkCommunityPublishingResult,
} from './adapters/vk-community-publishing-adapter.ts';

export interface VkCommunityExecutionPort {
  publish(publicationId: string, identityContext: unknown): Promise<VkCommunityPublishingResult>;
}

export interface VkCommunityPersistedResultRecord {
  readonly publicationId: string;
  readonly platform: 'VK_COMMUNITY';
  readonly status: 'PUBLISHED';
  readonly ownerId: number;
  readonly postId: number;
  readonly idempotencyKey: string;
  readonly publishedAt: string;
}

export interface VkCommunityResultPersistencePort {
  recordSuccess(input: {
    readonly publicationId: string;
    readonly actorId: 'publishing_service';
    readonly ownerId: number;
    readonly postId: number;
    readonly idempotencyKey: string;
    readonly publishedAt: string;
  }): Promise<VkCommunityPersistedResultRecord>;
}

export interface VkCommunityLivePublisherOptions {
  readonly execution: VkCommunityExecutionPort;
  readonly results: VkCommunityResultPersistencePort;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{64}$/u;

function isExactTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function requireExternalEvidence(
  requestedPublicationId: string,
  external: VkCommunityPublishingResult,
): void {
  if (
    !UUID_PATTERN.test(requestedPublicationId) ||
    external.publicationId !== requestedPublicationId ||
    external.platform !== 'VK_COMMUNITY' ||
    !Number.isSafeInteger(external.ownerId) ||
    external.ownerId >= 0 ||
    external.ownerId < -2_147_483_647 ||
    !Number.isSafeInteger(external.postId) ||
    external.postId < 1 ||
    !IDEMPOTENCY_KEY_PATTERN.test(external.idempotencyKey) ||
    !isExactTimestamp(external.publishedAt)
  ) {
    throw new VkCommunityPublishingError('VK_RESULT_EVIDENCE_INVALID');
  }
}

function evidenceMatches(
  external: VkCommunityPublishingResult,
  persisted: VkCommunityPersistedResultRecord,
): boolean {
  return (
    persisted.publicationId === external.publicationId &&
    persisted.platform === 'VK_COMMUNITY' &&
    persisted.status === 'PUBLISHED' &&
    persisted.ownerId === external.ownerId &&
    persisted.postId === external.postId &&
    persisted.idempotencyKey === external.idempotencyKey &&
    persisted.publishedAt === external.publishedAt
  );
}

export class VkCommunityLivePublisher {
  readonly #execution: VkCommunityExecutionPort;
  readonly #results: VkCommunityResultPersistencePort;

  constructor(options: VkCommunityLivePublisherOptions) {
    this.#execution = options.execution;
    this.#results = options.results;
  }

  async publishAndPersist(
    publicationId: string,
    identityContext: unknown,
  ): Promise<VkCommunityPublishingResult> {
    const external = await this.#execution.publish(publicationId, identityContext);
    requireExternalEvidence(publicationId, external);

    let persisted: VkCommunityPersistedResultRecord;
    try {
      persisted = await this.#results.recordSuccess({
        publicationId: external.publicationId,
        actorId: 'publishing_service',
        ownerId: external.ownerId,
        postId: external.postId,
        idempotencyKey: external.idempotencyKey,
        publishedAt: external.publishedAt,
      });
    } catch {
      throw new VkCommunityPublishingError('VK_RESULT_PERSIST_FAILED');
    }

    if (!evidenceMatches(external, persisted)) {
      throw new VkCommunityPublishingError('VK_RESULT_EVIDENCE_INVALID');
    }

    return external;
  }
}
