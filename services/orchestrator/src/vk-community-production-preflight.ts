import { createHash, createPublicKey } from 'node:crypto';

export type VkCommunityProductionPreflightReason =
  | 'COMMUNITY_ID_MISSING'
  | 'COMMUNITY_ID_INVALID'
  | 'OWNER_PUBLIC_KEY_MISSING'
  | 'OWNER_PUBLIC_KEY_INVALID'
  | 'VK_CREDENTIAL_REFERENCE_MISSING'
  | 'VK_CREDENTIAL_REFERENCE_INVALID'
  | 'PUBLISHING_IDENTITY_REFERENCE_MISSING'
  | 'PUBLISHING_IDENTITY_REFERENCE_INVALID';

export interface VkCommunityProductionSecretReference {
  readonly provider: string;
  readonly key: string;
}

export interface VkCommunityProductionPreflightInput {
  readonly communityId?: unknown;
  readonly ownerApprovalPublicKey?: unknown;
  readonly vkCredentialSecretReference?: unknown;
  readonly publishingIdentitySecretReference?: unknown;
}

export interface VkCommunityProductionPreflightReady {
  readonly status: 'READY';
  readonly communityId: number;
  readonly ownerId: number;
  readonly ownerPublicKeyFingerprint: string;
  readonly vkCredentialSecretReference: VkCommunityProductionSecretReference;
  readonly publishingIdentitySecretReference: VkCommunityProductionSecretReference;
}

export interface VkCommunityProductionPreflightBlocked {
  readonly status: 'BLOCKED';
  readonly reasons: readonly VkCommunityProductionPreflightReason[];
}

export type VkCommunityProductionPreflightResult =
  | VkCommunityProductionPreflightReady
  | VkCommunityProductionPreflightBlocked;

const SECRET_PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const SECRET_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const VK_CREDENTIAL_PREFIX = 'publishing/vk-community/';
const PUBLISHING_IDENTITY_PREFIX = 'publishing/identity/vk-community/';
const MAX_PUBLIC_KEY_LENGTH = 4_096;

function parseCommunityId(value: unknown): number | null {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 2_147_483_647
  ) {
    return null;
  }
  return value;
}

function parseOwnerPublicKey(value: unknown): { readonly fingerprint: string } | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_PUBLIC_KEY_LENGTH ||
    value.includes('\u0000')
  ) {
    return null;
  }

  try {
    const key = createPublicKey(value);
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
      return null;
    }
    const der = key.export({ type: 'spki', format: 'der' });
    return Object.freeze({
      fingerprint: 'sha256:' + createHash('sha256').update(der).digest('hex'),
    });
  } catch {
    return null;
  }
}

function parseSecretReference(
  value: unknown,
  requiredPrefix: string,
): VkCommunityProductionSecretReference | null {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return null;
  }
  const reference = value as Record<string, unknown>;
  const keys = Object.keys(reference).sort();
  if (keys.length !== 2 || keys[0] !== 'key' || keys[1] !== 'provider') {
    return null;
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
    !key.startsWith(requiredPrefix)
  ) {
    return null;
  }

  return Object.freeze({ provider, key });
}

export function preflightVkCommunityProductionActivation(
  input: VkCommunityProductionPreflightInput,
): VkCommunityProductionPreflightResult {
  const reasons: VkCommunityProductionPreflightReason[] = [];

  const communityId = parseCommunityId(input.communityId);
  if (input.communityId === undefined || input.communityId === null) {
    reasons.push('COMMUNITY_ID_MISSING');
  } else if (communityId === null) {
    reasons.push('COMMUNITY_ID_INVALID');
  }

  const ownerPublicKey = parseOwnerPublicKey(input.ownerApprovalPublicKey);
  if (input.ownerApprovalPublicKey === undefined || input.ownerApprovalPublicKey === null) {
    reasons.push('OWNER_PUBLIC_KEY_MISSING');
  } else if (ownerPublicKey === null) {
    reasons.push('OWNER_PUBLIC_KEY_INVALID');
  }

  const vkCredentialSecretReference = parseSecretReference(
    input.vkCredentialSecretReference,
    VK_CREDENTIAL_PREFIX,
  );
  if (
    input.vkCredentialSecretReference === undefined ||
    input.vkCredentialSecretReference === null
  ) {
    reasons.push('VK_CREDENTIAL_REFERENCE_MISSING');
  } else if (vkCredentialSecretReference === null) {
    reasons.push('VK_CREDENTIAL_REFERENCE_INVALID');
  }

  const publishingIdentitySecretReference = parseSecretReference(
    input.publishingIdentitySecretReference,
    PUBLISHING_IDENTITY_PREFIX,
  );
  if (
    input.publishingIdentitySecretReference === undefined ||
    input.publishingIdentitySecretReference === null
  ) {
    reasons.push('PUBLISHING_IDENTITY_REFERENCE_MISSING');
  } else if (publishingIdentitySecretReference === null) {
    reasons.push('PUBLISHING_IDENTITY_REFERENCE_INVALID');
  }

  if (
    reasons.length > 0 ||
    communityId === null ||
    ownerPublicKey === null ||
    vkCredentialSecretReference === null ||
    publishingIdentitySecretReference === null
  ) {
    return Object.freeze({
      status: 'BLOCKED' as const,
      reasons: Object.freeze([...reasons]),
    });
  }

  return Object.freeze({
    status: 'READY' as const,
    communityId,
    ownerId: -communityId,
    ownerPublicKeyFingerprint: ownerPublicKey.fingerprint,
    vkCredentialSecretReference,
    publishingIdentitySecretReference,
  });
}
