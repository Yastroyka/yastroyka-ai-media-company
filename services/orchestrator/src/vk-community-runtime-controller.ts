import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  VkCommunityPublishingPreview,
  VkCommunityPublishingResult,
  VkCommunitySecretProviderPort,
  VkCommunitySecretReference,
} from './adapters/vk-community-publishing-adapter.ts';

export type VkCommunityRuntimeGateErrorCode =
  | 'VK_OWNER_GRANT_FAILED'
  | 'VK_IDENTITY_ISSUE_FAILED'
  | 'VK_RUNTIME_PREVIEW_INVALID'
  | 'VK_RUNTIME_RESULT_INVALID';

export class VkCommunityRuntimeGateError extends Error {
  readonly code: VkCommunityRuntimeGateErrorCode;

  constructor(code: VkCommunityRuntimeGateErrorCode) {
    super(code);
    this.name = 'VkCommunityRuntimeGateError';
    this.code = code;
  }
}

export interface VkCommunityRuntimePreviewPort {
  preview(publicationId: string): Promise<VkCommunityPublishingPreview>;
}

export interface VkCommunityRuntimePublishPort {
  publishAndPersist(
    publicationId: string,
    identityContext: unknown,
  ): Promise<VkCommunityPublishingResult>;
}

export interface VkCommunityRuntimeControllerOptions {
  readonly communityId: number;
  readonly ownerApprovalSecretReference: unknown;
  readonly publishingIdentitySecretReference: unknown;
  readonly secretProvider: VkCommunitySecretProviderPort;
  readonly previewer: VkCommunityRuntimePreviewPort;
  readonly publisher: VkCommunityRuntimePublishPort;
  readonly clock?: () => Date;
  readonly identityLifetimeMilliseconds?: number;
}

interface OwnerGrantAssertion {
  readonly actor_id: 'human_owner';
  readonly audience: 'vk-community-execute';
  readonly grant_id: string;
  readonly publication_id: string;
  readonly owner_id: number;
  readonly issued_at: string;
  readonly expires_at: string;
}

interface OwnerGrantEnvelope {
  readonly version: 1;
  readonly assertion: OwnerGrantAssertion;
  readonly signature: string;
}

interface PublishingIdentityAssertion {
  readonly actor_id: 'publishing_service';
  readonly audience: 'vk-community-publish';
  readonly binding_id: string;
  readonly publication_id: string;
  readonly owner_id: number;
  readonly issued_at: string;
  readonly expires_at: string;
}

interface PublishingIdentityEnvelope {
  readonly version: 1;
  readonly assertion: PublishingIdentityAssertion;
  readonly signature: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const SECRET_PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const SECRET_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{64}$/u;

const OWNER_APPROVAL_SECRET_KEY_PREFIX = 'publishing/owner-approval/vk-community/';
const PUBLISHING_IDENTITY_SECRET_KEY_PREFIX = 'publishing/identity/vk-community/';
const MAX_SECRET_LENGTH = 8_192;
const MIN_HMAC_SECRET_LENGTH = 32;
const MAX_OWNER_GRANT_LIFETIME_MS = 5 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 30 * 1_000;
const DEFAULT_IDENTITY_LIFETIME_MS = 2 * 60 * 1_000;
const MIN_IDENTITY_LIFETIME_MS = 30 * 1_000;
const MAX_IDENTITY_LIFETIME_MS = 5 * 60 * 1_000;
const MAX_MESSAGE_LENGTH = 8_192;

function fail(code: VkCommunityRuntimeGateErrorCode): never {
  throw new VkCommunityRuntimeGateError(code);
}

function expectPlainObject(
  value: unknown,
  code: VkCommunityRuntimeGateErrorCode,
): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    fail(code);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(code);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  code: VkCommunityRuntimeGateErrorCode,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length) {
    fail(code);
  }
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== wanted[index]) {
      fail(code);
    }
  }
}

function requireCommunityId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error('communityId must be a positive 32-bit integer.');
  }
  return value;
}

function requireIdentityLifetime(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_IDENTITY_LIFETIME_MS ||
    value > MAX_IDENTITY_LIFETIME_MS
  ) {
    throw new Error('identityLifetimeMilliseconds must be between 30000 and 300000.');
  }
  return value;
}

function parseExactTimestamp(
  value: unknown,
  code: VkCommunityRuntimeGateErrorCode,
): { readonly value: string; readonly milliseconds: number } {
  if (typeof value !== 'string') {
    fail(code);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail(code);
  }
  return { value, milliseconds };
}

function parseSecretReference(
  value: unknown,
  requiredPrefix: string,
  code: VkCommunityRuntimeGateErrorCode,
): VkCommunitySecretReference {
  const reference = expectPlainObject(value, code);
  requireExactKeys(reference, ['provider', 'key'], code);
  const provider = reference.provider;
  const key = reference.key;
  if (
    typeof provider !== 'string' ||
    typeof key !== 'string' ||
    provider.length > 256 ||
    key.length > 256 ||
    !SECRET_PROVIDER_PATTERN.test(provider) ||
    !SECRET_KEY_PATTERN.test(key) ||
    !key.startsWith(requiredPrefix)
  ) {
    fail(code);
  }
  return Object.freeze({ provider, key });
}

function requireHmacSecret(secret: string, code: VkCommunityRuntimeGateErrorCode): string {
  if (
    typeof secret !== 'string' ||
    secret.length < MIN_HMAC_SECRET_LENGTH ||
    secret.length > MAX_SECRET_LENGTH ||
    secret.includes('\u0000')
  ) {
    fail(code);
  }
  return secret;
}

function parseOwnerGrant(
  value: unknown,
  publicationId: string,
  ownerId: number,
  nowMilliseconds: number,
): OwnerGrantEnvelope {
  const code = 'VK_OWNER_GRANT_FAILED' as const;
  const envelope = expectPlainObject(value, code);
  requireExactKeys(envelope, ['version', 'assertion', 'signature'], code);
  if (envelope.version !== 1 || typeof envelope.signature !== 'string') {
    fail(code);
  }

  const assertion = expectPlainObject(envelope.assertion, code);
  requireExactKeys(
    assertion,
    [
      'actor_id',
      'audience',
      'grant_id',
      'publication_id',
      'owner_id',
      'issued_at',
      'expires_at',
    ],
    code,
  );

  const grantId = assertion.grant_id;
  const grantPublicationId = assertion.publication_id;
  const grantOwnerId = assertion.owner_id;
  const issuedAt = parseExactTimestamp(assertion.issued_at, code);
  const expiresAt = parseExactTimestamp(assertion.expires_at, code);

  if (
    assertion.actor_id !== 'human_owner' ||
    assertion.audience !== 'vk-community-execute' ||
    typeof grantId !== 'string' ||
    !SAFE_ID_PATTERN.test(grantId) ||
    typeof grantPublicationId !== 'string' ||
    !UUID_PATTERN.test(grantPublicationId) ||
    grantPublicationId !== publicationId ||
    typeof grantOwnerId !== 'number' ||
    !Number.isSafeInteger(grantOwnerId) ||
    grantOwnerId !== ownerId ||
    issuedAt.milliseconds >= expiresAt.milliseconds ||
    expiresAt.milliseconds - issuedAt.milliseconds > MAX_OWNER_GRANT_LIFETIME_MS ||
    issuedAt.milliseconds > nowMilliseconds + MAX_FUTURE_SKEW_MS ||
    expiresAt.milliseconds <= nowMilliseconds ||
    !SIGNATURE_PATTERN.test(envelope.signature)
  ) {
    fail(code);
  }

  return Object.freeze({
    version: 1 as const,
    assertion: Object.freeze({
      actor_id: 'human_owner' as const,
      audience: 'vk-community-execute' as const,
      grant_id: grantId,
      publication_id: grantPublicationId,
      owner_id: grantOwnerId,
      issued_at: issuedAt.value,
      expires_at: expiresAt.value,
    }),
    signature: envelope.signature,
  });
}

function ownerGrantSigningPayload(assertion: OwnerGrantAssertion): string {
  return JSON.stringify({
    version: 1,
    actor_id: assertion.actor_id,
    audience: assertion.audience,
    grant_id: assertion.grant_id,
    publication_id: assertion.publication_id,
    owner_id: assertion.owner_id,
    issued_at: assertion.issued_at,
    expires_at: assertion.expires_at,
  });
}

function publishingIdentitySigningPayload(assertion: PublishingIdentityAssertion): string {
  return JSON.stringify({
    version: 1,
    actor_id: assertion.actor_id,
    audience: assertion.audience,
    binding_id: assertion.binding_id,
    publication_id: assertion.publication_id,
    owner_id: assertion.owner_id,
    issued_at: assertion.issued_at,
    expires_at: assertion.expires_at,
  });
}

function verifyOwnerGrantSignature(envelope: OwnerGrantEnvelope, secret: string): void {
  const code = 'VK_OWNER_GRANT_FAILED' as const;
  const expected = createHmac('sha256', requireHmacSecret(secret, code))
    .update(ownerGrantSigningPayload(envelope.assertion), 'utf8')
    .digest();
  const supplied = Buffer.from(envelope.signature, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    fail(code);
  }
}

function createPublishingIdentityEnvelope(
  grant: OwnerGrantEnvelope,
  now: Date,
  identityLifetimeMilliseconds: number,
  secret: string,
): PublishingIdentityEnvelope {
  const code = 'VK_IDENTITY_ISSUE_FAILED' as const;
  const nowMilliseconds = now.getTime();
  if (!Number.isFinite(nowMilliseconds)) {
    fail(code);
  }

  const grantExpiresAt = Date.parse(grant.assertion.expires_at);
  const expiresAtMilliseconds = Math.min(
    nowMilliseconds + identityLifetimeMilliseconds,
    grantExpiresAt,
  );
  if (!Number.isFinite(grantExpiresAt) || expiresAtMilliseconds <= nowMilliseconds) {
    fail(code);
  }

  const assertion: PublishingIdentityAssertion = Object.freeze({
    actor_id: 'publishing_service',
    audience: 'vk-community-publish',
    binding_id: grant.assertion.grant_id,
    publication_id: grant.assertion.publication_id,
    owner_id: grant.assertion.owner_id,
    issued_at: new Date(nowMilliseconds).toISOString(),
    expires_at: new Date(expiresAtMilliseconds).toISOString(),
  });
  const signature = createHmac('sha256', requireHmacSecret(secret, code))
    .update(publishingIdentitySigningPayload(assertion), 'utf8')
    .digest('hex');

  return Object.freeze({
    version: 1 as const,
    assertion,
    signature,
  });
}

async function consumeSecretExactlyOnce<T>(
  provider: VkCommunitySecretProviderPort,
  reference: VkCommunitySecretReference,
  code: VkCommunityRuntimeGateErrorCode,
  consumer: (secret: string) => T | Promise<T>,
): Promise<T> {
  let executionPromise: Promise<T> | null = null;
  let secretWindowOpen = true;

  try {
    await provider.withSecret(reference, (secret) => {
      if (!secretWindowOpen) {
        fail(code);
      }
      if (executionPromise === null) {
        executionPromise = Promise.resolve().then(() => consumer(secret));
      }
      return executionPromise;
    });
  } catch (error) {
    secretWindowOpen = false;
    if (executionPromise === null) {
      if (error instanceof VkCommunityRuntimeGateError) {
        throw error;
      }
      fail(code);
    }
  }

  secretWindowOpen = false;
  const execution = executionPromise;
  if (execution === null) {
    fail(code);
  }

  try {
    return await execution;
  } catch (error) {
    if (error instanceof VkCommunityRuntimeGateError) {
      throw error;
    }
    fail(code);
  }
}

function requirePreview(
  preview: VkCommunityPublishingPreview,
  publicationId: string,
  expectedOwnerId: number,
): VkCommunityPublishingPreview {
  if (
    preview.publicationId !== publicationId ||
    preview.platform !== 'VK_COMMUNITY' ||
    preview.ownerId !== expectedOwnerId ||
    preview.fromGroup !== true ||
    typeof preview.message !== 'string' ||
    preview.message.length === 0 ||
    preview.message.length > MAX_MESSAGE_LENGTH ||
    preview.message.includes('\u0000') ||
    !IDEMPOTENCY_KEY_PATTERN.test(preview.idempotencyKey)
  ) {
    fail('VK_RUNTIME_PREVIEW_INVALID');
  }
  return preview;
}

function isExactTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function requireResult(
  result: VkCommunityPublishingResult,
  preview: VkCommunityPublishingPreview,
): VkCommunityPublishingResult {
  if (
    result.publicationId !== preview.publicationId ||
    result.platform !== 'VK_COMMUNITY' ||
    result.ownerId !== preview.ownerId ||
    !Number.isSafeInteger(result.postId) ||
    result.postId < 1 ||
    result.idempotencyKey !== preview.idempotencyKey ||
    !isExactTimestamp(result.publishedAt)
  ) {
    fail('VK_RUNTIME_RESULT_INVALID');
  }
  return result;
}

export class VkCommunityRuntimeController {
  readonly #ownerId: number;
  readonly #ownerApprovalSecretReference: VkCommunitySecretReference;
  readonly #publishingIdentitySecretReference: VkCommunitySecretReference;
  readonly #secretProvider: VkCommunitySecretProviderPort;
  readonly #previewer: VkCommunityRuntimePreviewPort;
  readonly #publisher: VkCommunityRuntimePublishPort;
  readonly #clock: () => Date;
  readonly #identityLifetimeMilliseconds: number;

  constructor(options: VkCommunityRuntimeControllerOptions) {
    this.#ownerId = -requireCommunityId(options.communityId);
    this.#ownerApprovalSecretReference = parseSecretReference(
      options.ownerApprovalSecretReference,
      OWNER_APPROVAL_SECRET_KEY_PREFIX,
      'VK_OWNER_GRANT_FAILED',
    );
    this.#publishingIdentitySecretReference = parseSecretReference(
      options.publishingIdentitySecretReference,
      PUBLISHING_IDENTITY_SECRET_KEY_PREFIX,
      'VK_IDENTITY_ISSUE_FAILED',
    );
    this.#secretProvider = options.secretProvider;
    this.#previewer = options.previewer;
    this.#publisher = options.publisher;
    this.#clock = options.clock ?? (() => new Date());
    this.#identityLifetimeMilliseconds = requireIdentityLifetime(
      options.identityLifetimeMilliseconds ?? DEFAULT_IDENTITY_LIFETIME_MS,
    );
  }

  async preview(publicationId: string): Promise<VkCommunityPublishingPreview> {
    if (!UUID_PATTERN.test(publicationId)) {
      fail('VK_RUNTIME_PREVIEW_INVALID');
    }

    let preview: VkCommunityPublishingPreview;
    try {
      preview = await this.#previewer.preview(publicationId);
    } catch (error) {
      if (error instanceof VkCommunityRuntimeGateError) {
        throw error;
      }
      fail('VK_RUNTIME_PREVIEW_INVALID');
    }
    return requirePreview(preview, publicationId, this.#ownerId);
  }

  async execute(
    publicationId: string,
    ownerGrantContext: unknown,
  ): Promise<VkCommunityPublishingResult> {
    const preview = await this.preview(publicationId);
    const now = this.#clock();
    const nowMilliseconds = now.getTime();
    if (!Number.isFinite(nowMilliseconds)) {
      fail('VK_OWNER_GRANT_FAILED');
    }

    const grant = parseOwnerGrant(ownerGrantContext, publicationId, this.#ownerId, nowMilliseconds);
    await consumeSecretExactlyOnce(
      this.#secretProvider,
      this.#ownerApprovalSecretReference,
      'VK_OWNER_GRANT_FAILED',
      (secret) => verifyOwnerGrantSignature(grant, secret),
    );

    const identity = await consumeSecretExactlyOnce(
      this.#secretProvider,
      this.#publishingIdentitySecretReference,
      'VK_IDENTITY_ISSUE_FAILED',
      (secret) =>
        createPublishingIdentityEnvelope(
          grant,
          now,
          this.#identityLifetimeMilliseconds,
          secret,
        ),
    );

    let result: VkCommunityPublishingResult;
    try {
      result = await this.#publisher.publishAndPersist(publicationId, identity);
    } catch (error) {
      if (error instanceof VkCommunityRuntimeGateError) {
        throw error;
      }
      throw error;
    }

    return requireResult(result, preview);
  }
}

export function createVkCommunityRuntimeController(
  options: VkCommunityRuntimeControllerOptions,
): VkCommunityRuntimeController {
  return new VkCommunityRuntimeController(options);
}
