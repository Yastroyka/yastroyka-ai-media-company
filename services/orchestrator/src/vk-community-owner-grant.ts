import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

export interface VkCommunityOwnerGrantAssertion {
  readonly actor_id: 'human_owner';
  readonly audience: 'vk-community-execute';
  readonly grant_id: string;
  readonly publication_id: string;
  readonly owner_id: number;
  readonly preview_fingerprint: string;
  readonly issued_at: string;
  readonly expires_at: string;
}

export interface VkCommunityOwnerGrantEnvelope {
  readonly version: 1;
  readonly assertion: VkCommunityOwnerGrantAssertion;
  readonly signature: string;
}

export interface CreateVkCommunityOwnerGrantAssertionInput {
  readonly grantId: string;
  readonly publicationId: string;
  readonly ownerId: number;
  readonly previewFingerprint: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface VkCommunityOwnerApprovalPublicKeyMetadata {
  readonly pem: string;
  readonly fingerprint: string;
}

export interface VerifyVkCommunityOwnerGrantInput {
  readonly grant: unknown;
  readonly ownerApprovalPublicKey: unknown;
  readonly publicationId: string;
  readonly ownerId: number;
  readonly previewFingerprint: string;
  readonly now: Date;
}

export class VkCommunityOwnerGrantError extends Error {
  constructor() {
    super('VK owner grant invalid');
    this.name = 'VkCommunityOwnerGrantError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const PREVIEW_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const OWNER_SIGNATURE_PATTERN = /^[0-9a-f]{128}$/u;
const MAX_PUBLIC_KEY_LENGTH = 4_096;
const MAX_OWNER_GRANT_LIFETIME_MS = 5 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 30 * 1_000;

function fail(): never {
  throw new VkCommunityOwnerGrantError();
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
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length) {
    fail();
  }
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== wanted[index]) {
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

function requireAssertionValues(assertion: VkCommunityOwnerGrantAssertion): void {
  if (
    assertion.actor_id !== 'human_owner' ||
    assertion.audience !== 'vk-community-execute' ||
    typeof assertion.grant_id !== 'string' ||
    !SAFE_ID_PATTERN.test(assertion.grant_id) ||
    typeof assertion.publication_id !== 'string' ||
    !UUID_PATTERN.test(assertion.publication_id) ||
    typeof assertion.owner_id !== 'number' ||
    !Number.isSafeInteger(assertion.owner_id) ||
    assertion.owner_id >= 0 ||
    assertion.owner_id < -2_147_483_647 ||
    typeof assertion.preview_fingerprint !== 'string' ||
    !PREVIEW_FINGERPRINT_PATTERN.test(assertion.preview_fingerprint)
  ) {
    fail();
  }

  const issuedAt = Date.parse(requireExactTimestamp(assertion.issued_at));
  const expiresAt = Date.parse(requireExactTimestamp(assertion.expires_at));
  if (issuedAt >= expiresAt || expiresAt - issuedAt > MAX_OWNER_GRANT_LIFETIME_MS) {
    fail();
  }
}

function parseAssertion(value: unknown): VkCommunityOwnerGrantAssertion {
  const assertion = expectPlainObject(value);
  requireExactKeys(assertion, [
    'actor_id',
    'audience',
    'grant_id',
    'publication_id',
    'owner_id',
    'preview_fingerprint',
    'issued_at',
    'expires_at',
  ]);

  const parsed: VkCommunityOwnerGrantAssertion = Object.freeze({
    actor_id: assertion.actor_id as 'human_owner',
    audience: assertion.audience as 'vk-community-execute',
    grant_id: assertion.grant_id as string,
    publication_id: assertion.publication_id as string,
    owner_id: assertion.owner_id as number,
    preview_fingerprint: assertion.preview_fingerprint as string,
    issued_at: assertion.issued_at as string,
    expires_at: assertion.expires_at as string,
  });
  requireAssertionValues(parsed);
  return parsed;
}

function parseEnvelope(value: unknown): VkCommunityOwnerGrantEnvelope {
  const envelope = expectPlainObject(value);
  requireExactKeys(envelope, ['version', 'assertion', 'signature']);
  if (
    envelope.version !== 1 ||
    typeof envelope.signature !== 'string' ||
    !OWNER_SIGNATURE_PATTERN.test(envelope.signature)
  ) {
    fail();
  }

  return Object.freeze({
    version: 1 as const,
    assertion: parseAssertion(envelope.assertion),
    signature: envelope.signature,
  });
}

function parseOwnerPublicKey(value: unknown): { readonly key: KeyObject; readonly pem: string } {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_PUBLIC_KEY_LENGTH ||
    value.includes('\u0000')
  ) {
    fail();
  }

  const normalized = value.trim();
  if (
    !normalized.startsWith('-----BEGIN PUBLIC KEY-----\n') ||
    !normalized.endsWith('\n-----END PUBLIC KEY-----') ||
    normalized.includes('PRIVATE KEY')
  ) {
    fail();
  }

  try {
    const key = createPublicKey(normalized);
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
      fail();
    }
    const pem = key.export({ type: 'spki', format: 'pem' }).toString();
    return Object.freeze({ key, pem });
  } catch (error) {
    if (error instanceof VkCommunityOwnerGrantError) {
      throw error;
    }
    fail();
  }
}

function requireOwnerPrivateKey(value: KeyObject): KeyObject {
  if (value.type !== 'private' || value.asymmetricKeyType !== 'ed25519') {
    fail();
  }
  return value;
}

export function inspectVkCommunityOwnerApprovalPublicKey(
  value: unknown,
): VkCommunityOwnerApprovalPublicKeyMetadata {
  const parsed = parseOwnerPublicKey(value);
  const der = parsed.key.export({ type: 'spki', format: 'der' });
  return Object.freeze({
    pem: parsed.pem,
    fingerprint: 'sha256:' + createHash('sha256').update(der).digest('hex'),
  });
}

export function createVkCommunityOwnerGrantAssertion(
  input: CreateVkCommunityOwnerGrantAssertionInput,
): VkCommunityOwnerGrantAssertion {
  const assertion = Object.freeze({
    actor_id: 'human_owner' as const,
    audience: 'vk-community-execute' as const,
    grant_id: input.grantId,
    publication_id: input.publicationId,
    owner_id: input.ownerId,
    preview_fingerprint: input.previewFingerprint,
    issued_at: requireExactTimestamp(input.issuedAt),
    expires_at: requireExactTimestamp(input.expiresAt),
  });
  requireAssertionValues(assertion);
  return assertion;
}

export function serializeVkCommunityOwnerGrantAssertion(
  assertion: VkCommunityOwnerGrantAssertion,
): string {
  requireAssertionValues(assertion);
  return JSON.stringify({
    version: 1,
    actor_id: assertion.actor_id,
    audience: assertion.audience,
    grant_id: assertion.grant_id,
    publication_id: assertion.publication_id,
    owner_id: assertion.owner_id,
    preview_fingerprint: assertion.preview_fingerprint,
    issued_at: assertion.issued_at,
    expires_at: assertion.expires_at,
  });
}

export function signVkCommunityOwnerGrant(
  assertion: VkCommunityOwnerGrantAssertion,
  ownerPrivateKey: KeyObject,
): VkCommunityOwnerGrantEnvelope {
  const privateKey = requireOwnerPrivateKey(ownerPrivateKey);
  const signature = sign(
    null,
    Buffer.from(serializeVkCommunityOwnerGrantAssertion(assertion), 'utf8'),
    privateKey,
  ).toString('hex');

  if (!OWNER_SIGNATURE_PATTERN.test(signature)) {
    fail();
  }

  return Object.freeze({
    version: 1 as const,
    assertion,
    signature,
  });
}

export function verifyVkCommunityOwnerGrant(
  input: VerifyVkCommunityOwnerGrantInput,
): VkCommunityOwnerGrantEnvelope {
  const envelope = parseEnvelope(input.grant);
  const publicKey = parseOwnerPublicKey(input.ownerApprovalPublicKey).key;
  const nowMilliseconds = input.now.getTime();
  const issuedAtMilliseconds = Date.parse(envelope.assertion.issued_at);
  const expiresAtMilliseconds = Date.parse(envelope.assertion.expires_at);

  if (
    !Number.isFinite(nowMilliseconds) ||
    envelope.assertion.publication_id !== input.publicationId ||
    envelope.assertion.owner_id !== input.ownerId ||
    envelope.assertion.preview_fingerprint !== input.previewFingerprint ||
    issuedAtMilliseconds >= expiresAtMilliseconds ||
    expiresAtMilliseconds - issuedAtMilliseconds > MAX_OWNER_GRANT_LIFETIME_MS ||
    issuedAtMilliseconds > nowMilliseconds + MAX_FUTURE_SKEW_MS ||
    expiresAtMilliseconds <= nowMilliseconds
  ) {
    fail();
  }

  try {
    const signature = Buffer.from(envelope.signature, 'hex');
    if (
      signature.length !== 64 ||
      !verify(
        null,
        Buffer.from(serializeVkCommunityOwnerGrantAssertion(envelope.assertion), 'utf8'),
        publicKey,
        signature,
      )
    ) {
      fail();
    }
  } catch (error) {
    if (error instanceof VkCommunityOwnerGrantError) {
      throw error;
    }
    fail();
  }

  return envelope;
}
