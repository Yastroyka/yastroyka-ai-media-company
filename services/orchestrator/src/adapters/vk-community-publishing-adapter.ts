import { createHash } from 'node:crypto';

export type VkCommunityPublishingErrorCode =
  | 'VK_IDENTITY_BINDING_FAILED'
  | 'VK_IDENTITY_DENIED'
  | 'VK_PUBLICATION_READ_FAILED'
  | 'VK_PUBLICATION_NOT_FOUND'
  | 'VK_PUBLICATION_NOT_AUTO'
  | 'VK_PUBLICATION_INVALID'
  | 'VK_SECRET_REFERENCE_INVALID'
  | 'VK_SECRET_ACCESS_FAILED'
  | 'VK_TRANSPORT_FAILED'
  | 'VK_TRANSPORT_EVIDENCE_INVALID';

export class VkCommunityPublishingError extends Error {
  readonly code: VkCommunityPublishingErrorCode;

  constructor(code: VkCommunityPublishingErrorCode) {
    super(code);
    this.name = 'VkCommunityPublishingError';
    this.code = code;
  }
}

export interface VkCommunityPublicationRecord {
  readonly publicationId: string;
  readonly platform: string;
  readonly status: string;
  readonly payload: unknown;
}

export interface VkCommunityPublicationStatePort {
  findById(publicationId: string): Promise<VkCommunityPublicationRecord | null>;
}

export interface PublishingIdentityBinding {
  readonly actorId: string;
  readonly audience: string;
  readonly bindingId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface PublishingIdentityBindingPort {
  bind(identityContext: unknown): Promise<PublishingIdentityBinding>;
}

export interface VkCommunitySecretReference {
  readonly provider: string;
  readonly key: string;
}

export interface VkCommunitySecretProviderPort {
  withSecret<T>(
    reference: VkCommunitySecretReference,
    consumer: (secret: string) => T | Promise<T>,
  ): Promise<T>;
}

export interface VkCommunityWallPostRequest {
  readonly ownerId: number;
  readonly fromGroup: true;
  readonly message: string;
  readonly randomId: number;
}

export interface VkCommunityPublishTransportResult {
  readonly ownerId: number;
  readonly postId: number;
}

export interface VkCommunityPublishTransport {
  publishWallPost(
    request: VkCommunityWallPostRequest,
    accessToken: string,
  ): Promise<VkCommunityPublishTransportResult>;
}

export interface VkCommunityPublishingPreview extends VkCommunityWallPostRequest {
  readonly publicationId: string;
  readonly platform: 'VK_COMMUNITY';
}

export interface VkCommunityPublishingResult {
  readonly publicationId: string;
  readonly platform: 'VK_COMMUNITY';
  readonly ownerId: number;
  readonly postId: number;
  readonly randomId: number;
  readonly publishedAt: string;
}

export interface VkCommunityPublishingAdapterOptions {
  readonly communityId: number;
  readonly secretReference: unknown;
  readonly publicationState: VkCommunityPublicationStatePort;
  readonly identityBinding: PublishingIdentityBindingPort;
  readonly secretProvider: VkCommunitySecretProviderPort;
  readonly transport: VkCommunityPublishTransport;
  readonly clock?: () => Date;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const SECRET_PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const SECRET_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const VK_SECRET_KEY_PREFIX = 'publishing/vk-community/';
const EXPECTED_ACTOR_ID = 'publishing_service';
const EXPECTED_AUDIENCE = 'vk-community-publish';
const MAX_BINDING_LIFETIME_MS = 5 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 30 * 1_000;
const MAX_MESSAGE_LENGTH = 8_192;
const MAX_SECRET_LENGTH = 8_192;

function fail(code: VkCommunityPublishingErrorCode): never {
  throw new VkCommunityPublishingError(code);
}

function requireUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    fail('VK_PUBLICATION_INVALID');
  }
}

function requireCommunityId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error('communityId must be a positive signed 32-bit integer.');
  }
  return value;
}

function expectPlainObject(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    fail('VK_PUBLICATION_INVALID');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('VK_PUBLICATION_INVALID');
  }
  return value as Record<string, unknown>;
}

function parseMessage(payloadValue: unknown): string {
  const payload = expectPlainObject(payloadValue);
  const vkCommunity = expectPlainObject(payload.vk_community);
  const keys = Object.keys(vkCommunity);
  if (keys.length !== 1 || keys[0] !== 'message') {
    fail('VK_PUBLICATION_INVALID');
  }

  const message = vkCommunity.message;
  if (
    typeof message !== 'string' ||
    message.length === 0 ||
    message.length > MAX_MESSAGE_LENGTH ||
    message.includes('\u0000')
  ) {
    fail('VK_PUBLICATION_INVALID');
  }
  return message;
}

function parseSecretReference(value: unknown): VkCommunitySecretReference {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    fail('VK_SECRET_REFERENCE_INVALID');
  }
  const reference = value as Record<string, unknown>;
  const keys = Object.keys(reference).sort();
  if (keys.length !== 2 || keys[0] !== 'key' || keys[1] !== 'provider') {
    fail('VK_SECRET_REFERENCE_INVALID');
  }

  const provider = reference.provider;
  const key = reference.key;
  if (
    typeof provider !== 'string' ||
    typeof key !== 'string' ||
    provider.length > 256 ||
    key.length > 256 ||
    !SECRET_PROVIDER_PATTERN.test(provider) ||
    !SECRET_KEY_PATTERN.test(key) ||
    !key.startsWith(VK_SECRET_KEY_PREFIX)
  ) {
    fail('VK_SECRET_REFERENCE_INVALID');
  }

  return { provider, key };
}

function deterministicRandomId(publicationId: string): number {
  const digest = createHash('sha256').update(publicationId, 'utf8').digest();
  const value = digest.readUInt32BE(0) & 0x7fffffff;
  return value === 0 ? 1 : value;
}

function parseExactTimestamp(value: string): number | null {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return null;
  }
  return milliseconds;
}

function requireTrustedBinding(binding: PublishingIdentityBinding, now: Date): void {
  const issuedAt = parseExactTimestamp(binding.issuedAt);
  const expiresAt = parseExactTimestamp(binding.expiresAt);
  if (
    binding.actorId !== EXPECTED_ACTOR_ID ||
    binding.audience !== EXPECTED_AUDIENCE ||
    !SAFE_ID_PATTERN.test(binding.bindingId) ||
    issuedAt === null ||
    expiresAt === null ||
    Number.isNaN(now.getTime()) ||
    issuedAt > now.getTime() + MAX_FUTURE_SKEW_MS ||
    expiresAt <= now.getTime() ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_BINDING_LIFETIME_MS ||
    now.getTime() - issuedAt > MAX_BINDING_LIFETIME_MS
  ) {
    fail('VK_IDENTITY_DENIED');
  }
}

function requireAccessToken(secret: string): void {
  if (typeof secret !== 'string' || secret.length === 0 || secret.length > MAX_SECRET_LENGTH) {
    fail('VK_SECRET_ACCESS_FAILED');
  }
}

export class VkCommunityPublishingAdapter {
  readonly #communityId: number;
  readonly #secretReference: VkCommunitySecretReference;
  readonly #publicationState: VkCommunityPublicationStatePort;
  readonly #identityBinding: PublishingIdentityBindingPort;
  readonly #secretProvider: VkCommunitySecretProviderPort;
  readonly #transport: VkCommunityPublishTransport;
  readonly #clock: () => Date;

  constructor(options: VkCommunityPublishingAdapterOptions) {
    this.#communityId = requireCommunityId(options.communityId);
    this.#secretReference = parseSecretReference(options.secretReference);
    this.#publicationState = options.publicationState;
    this.#identityBinding = options.identityBinding;
    this.#secretProvider = options.secretProvider;
    this.#transport = options.transport;
    this.#clock = options.clock ?? (() => new Date());
  }

  async #buildPreview(publicationId: string): Promise<VkCommunityPublishingPreview> {
    requireUuid(publicationId);

    let record: VkCommunityPublicationRecord | null;
    try {
      record = await this.#publicationState.findById(publicationId);
    } catch {
      fail('VK_PUBLICATION_READ_FAILED');
    }

    if (record === null) {
      fail('VK_PUBLICATION_NOT_FOUND');
    }
    if (record.publicationId !== publicationId || record.platform !== 'VK_COMMUNITY') {
      fail('VK_PUBLICATION_INVALID');
    }
    if (record.status !== 'AUTO') {
      fail('VK_PUBLICATION_NOT_AUTO');
    }

    return Object.freeze({
      publicationId,
      platform: 'VK_COMMUNITY' as const,
      ownerId: -this.#communityId,
      fromGroup: true as const,
      message: parseMessage(record.payload),
      randomId: deterministicRandomId(publicationId),
    });
  }

  async preview(publicationId: string): Promise<VkCommunityPublishingPreview> {
    return this.#buildPreview(publicationId);
  }

  async publish(
    publicationId: string,
    identityContext: unknown,
  ): Promise<VkCommunityPublishingResult> {
    let binding: PublishingIdentityBinding;
    try {
      binding = await this.#identityBinding.bind(identityContext);
    } catch {
      fail('VK_IDENTITY_BINDING_FAILED');
    }
    requireTrustedBinding(binding, this.#clock());

    const preview = await this.#buildPreview(publicationId);

    try {
      return await this.#secretProvider.withSecret(this.#secretReference, async (secret) => {
        requireAccessToken(secret);

        let transportResult: VkCommunityPublishTransportResult;
        try {
          transportResult = await this.#transport.publishWallPost(
            {
              ownerId: preview.ownerId,
              fromGroup: true,
              message: preview.message,
              randomId: preview.randomId,
            },
            secret,
          );
        } catch {
          fail('VK_TRANSPORT_FAILED');
        }

        if (
          transportResult.ownerId !== preview.ownerId ||
          !Number.isSafeInteger(transportResult.postId) ||
          transportResult.postId < 1
        ) {
          fail('VK_TRANSPORT_EVIDENCE_INVALID');
        }

        const publishedAt = this.#clock();
        if (Number.isNaN(publishedAt.getTime())) {
          fail('VK_TRANSPORT_EVIDENCE_INVALID');
        }

        return Object.freeze({
          publicationId: preview.publicationId,
          platform: 'VK_COMMUNITY' as const,
          ownerId: transportResult.ownerId,
          postId: transportResult.postId,
          randomId: preview.randomId,
          publishedAt: publishedAt.toISOString(),
        });
      });
    } catch (error) {
      if (error instanceof VkCommunityPublishingError) {
        throw error;
      }
      fail('VK_SECRET_ACCESS_FAILED');
    }
  }
}
