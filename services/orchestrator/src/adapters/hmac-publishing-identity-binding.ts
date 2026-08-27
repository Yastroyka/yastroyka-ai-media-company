import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  PublishingIdentityBinding,
  PublishingIdentityBindingPort,
  VkCommunitySecretProviderPort,
  VkCommunitySecretReference,
} from './vk-community-publishing-adapter.ts';

export class PublishingIdentityVerificationError extends Error {
  constructor() {
    super('publishing identity verification failed');
    this.name = 'PublishingIdentityVerificationError';
  }
}

export interface HmacPublishingIdentityBindingOptions {
  readonly secretReference: unknown;
  readonly secretProvider: VkCommunitySecretProviderPort;
}

interface IdentityAssertion {
  readonly actor_id: string;
  readonly audience: string;
  readonly binding_id: string;
  readonly publication_id: string;
  readonly owner_id: number;
  readonly preview_fingerprint: string;
  readonly issued_at: string;
  readonly expires_at: string;
}

interface IdentityEnvelope {
  readonly version: 1;
  readonly assertion: IdentityAssertion;
  readonly signature: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const SECRET_PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const SECRET_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/u;
const PREVIEW_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const IDENTITY_SECRET_KEY_PREFIX = 'publishing/identity/vk-community/';
const EXPECTED_ACTOR_ID = 'publishing_service';
const EXPECTED_AUDIENCE = 'vk-community-publish';
const MIN_HMAC_SECRET_LENGTH = 32;
const MAX_HMAC_SECRET_LENGTH = 8_192;

function fail(): never {
  throw new PublishingIdentityVerificationError();
}

function expectPlainObject(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    fail();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail();
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length) {
    fail();
  }
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== sortedExpected[index]) {
      fail();
    }
  }
}

function requireExactTimestamp(value: unknown): string {
  if (typeof value !== 'string') {
    fail();
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail();
  }
  return value;
}

function parseSecretReference(value: unknown): VkCommunitySecretReference {
  const reference = expectPlainObject(value);
  requireExactKeys(reference, ['provider', 'key']);
  const provider = reference.provider;
  const key = reference.key;
  if (
    typeof provider !== 'string' ||
    typeof key !== 'string' ||
    provider.length > 256 ||
    key.length > 256 ||
    !SECRET_PROVIDER_PATTERN.test(provider) ||
    !SECRET_KEY_PATTERN.test(key) ||
    !key.startsWith(IDENTITY_SECRET_KEY_PREFIX)
  ) {
    fail();
  }
  return { provider, key };
}

function parseEnvelope(value: unknown): IdentityEnvelope {
  const envelope = expectPlainObject(value);
  requireExactKeys(envelope, ['version', 'assertion', 'signature']);
  if (envelope.version !== 1 || typeof envelope.signature !== 'string') {
    fail();
  }

  const assertion = expectPlainObject(envelope.assertion);
  requireExactKeys(assertion, [
    'actor_id',
    'audience',
    'binding_id',
    'publication_id',
    'owner_id',
    'preview_fingerprint',
    'issued_at',
    'expires_at',
  ]);

  const actorId = assertion.actor_id;
  const audience = assertion.audience;
  const bindingId = assertion.binding_id;
  const publicationId = assertion.publication_id;
  const ownerId = assertion.owner_id;
  const previewFingerprint = assertion.preview_fingerprint;
  if (
    actorId !== EXPECTED_ACTOR_ID ||
    audience !== EXPECTED_AUDIENCE ||
    typeof bindingId !== 'string' ||
    !SAFE_ID_PATTERN.test(bindingId) ||
    typeof publicationId !== 'string' ||
    !UUID_PATTERN.test(publicationId) ||
    typeof ownerId !== 'number' ||
    !Number.isSafeInteger(ownerId) ||
    ownerId >= 0 ||
    ownerId < -2_147_483_647 ||
    typeof previewFingerprint !== 'string' ||
    !PREVIEW_FINGERPRINT_PATTERN.test(previewFingerprint) ||
    !SIGNATURE_PATTERN.test(envelope.signature)
  ) {
    fail();
  }

  return {
    version: 1,
    assertion: {
      actor_id: actorId,
      audience,
      binding_id: bindingId,
      publication_id: publicationId,
      owner_id: ownerId,
      preview_fingerprint: previewFingerprint,
      issued_at: requireExactTimestamp(assertion.issued_at),
      expires_at: requireExactTimestamp(assertion.expires_at),
    },
    signature: envelope.signature,
  };
}

function signingPayload(assertion: IdentityAssertion): string {
  return JSON.stringify({
    version: 1,
    actor_id: assertion.actor_id,
    audience: assertion.audience,
    binding_id: assertion.binding_id,
    publication_id: assertion.publication_id,
    owner_id: assertion.owner_id,
    preview_fingerprint: assertion.preview_fingerprint,
    issued_at: assertion.issued_at,
    expires_at: assertion.expires_at,
  });
}

function verifyEnvelope(envelope: IdentityEnvelope, secret: string): PublishingIdentityBinding {
  if (
    typeof secret !== 'string' ||
    secret.length < MIN_HMAC_SECRET_LENGTH ||
    secret.length > MAX_HMAC_SECRET_LENGTH ||
    secret.includes('\u0000')
  ) {
    fail();
  }

  const expected = createHmac('sha256', secret)
    .update(signingPayload(envelope.assertion), 'utf8')
    .digest();
  const supplied = Buffer.from(envelope.signature, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    fail();
  }

  return Object.freeze({
    actorId: envelope.assertion.actor_id,
    audience: envelope.assertion.audience,
    bindingId: envelope.assertion.binding_id,
    publicationId: envelope.assertion.publication_id,
    ownerId: envelope.assertion.owner_id,
    previewFingerprint: envelope.assertion.preview_fingerprint,
    issuedAt: envelope.assertion.issued_at,
    expiresAt: envelope.assertion.expires_at,
  });
}

export class HmacPublishingIdentityBinding implements PublishingIdentityBindingPort {
  readonly #secretReference: VkCommunitySecretReference;
  readonly #secretProvider: VkCommunitySecretProviderPort;

  constructor(options: HmacPublishingIdentityBindingOptions) {
    this.#secretReference = parseSecretReference(options.secretReference);
    this.#secretProvider = options.secretProvider;
  }

  async bind(identityContext: unknown): Promise<PublishingIdentityBinding> {
    const envelope = parseEnvelope(identityContext);
    let verificationPromise: Promise<PublishingIdentityBinding> | null = null;
    let secretWindowOpen = true;

    try {
      await this.#secretProvider.withSecret(this.#secretReference, (secret) => {
        if (!secretWindowOpen) {
          fail();
        }
        if (verificationPromise === null) {
          verificationPromise = Promise.resolve().then(() => verifyEnvelope(envelope, secret));
        }
        return verificationPromise;
      });
    } catch {
      secretWindowOpen = false;
      if (verificationPromise === null) {
        fail();
      }
    }

    secretWindowOpen = false;
    const verification = verificationPromise;
    if (verification === null) {
      fail();
    }

    try {
      return await verification;
    } catch {
      fail();
    }
  }
}
