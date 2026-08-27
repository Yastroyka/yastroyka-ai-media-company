import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  VkCommunityOwnerGrantError,
  createVkCommunityOwnerGrantAssertion,
  inspectVkCommunityOwnerApprovalPublicKey,
  serializeVkCommunityOwnerGrantAssertion,
  signVkCommunityOwnerGrant,
  verifyVkCommunityOwnerGrant,
} from '../src/vk-community-owner-grant.ts';

const PUBLICATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_ID = -123456;
const PREVIEW_FINGERPRINT = 'a'.repeat(64);
const ISSUED_AT = '2026-08-27T07:00:00.000Z';
const EXPIRES_AT = '2026-08-27T07:02:00.000Z';
const NOW = new Date('2026-08-27T07:01:00.000Z');

function buildAssertion() {
  return createVkCommunityOwnerGrantAssertion({
    grantId: 'owner-grant-production-001',
    publicationId: PUBLICATION_ID,
    ownerId: OWNER_ID,
    previewFingerprint: PREVIEW_FINGERPRINT,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
  });
}

test('offline signer and verifier share one canonical owner-grant payload', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const assertion = buildAssertion();

  assert.equal(
    serializeVkCommunityOwnerGrantAssertion(assertion),
    JSON.stringify({
      version: 1,
      actor_id: 'human_owner',
      audience: 'vk-community-execute',
      grant_id: 'owner-grant-production-001',
      publication_id: PUBLICATION_ID,
      owner_id: OWNER_ID,
      preview_fingerprint: PREVIEW_FINGERPRINT,
      issued_at: ISSUED_AT,
      expires_at: EXPIRES_AT,
    }),
  );

  const grant = signVkCommunityOwnerGrant(assertion, privateKey);
  const verified = verifyVkCommunityOwnerGrant({
    grant,
    ownerApprovalPublicKey: publicPem,
    publicationId: PUBLICATION_ID,
    ownerId: OWNER_ID,
    previewFingerprint: PREVIEW_FINGERPRINT,
    now: NOW,
  });

  assert.deepEqual(verified, grant);
  assert.equal(Object.hasOwn(grant, 'privateKey'), false);
  assert.equal(JSON.stringify(grant).includes('PRIVATE KEY'), false);
  assert.match(grant.signature, /^[0-9a-f]{128}$/u);
});

test('owner public-key inspection returns only public metadata and a stable fingerprint', () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  const first = inspectVkCommunityOwnerApprovalPublicKey(publicPem);
  const second = inspectVkCommunityOwnerApprovalPublicKey(publicPem);

  assert.equal(first.pem, publicPem);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.match(first.fingerprint, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(first).includes('PRIVATE KEY'), false);
});

test('owner public-key boundary rejects Ed25519 private PEM material', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  assert.throws(
    () => inspectVkCommunityOwnerApprovalPublicKey(privatePem),
    VkCommunityOwnerGrantError,
  );
});

test('owner grant tampering, expiry and wrong verification key fail closed', () => {
  const signer = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');
  const signerPublicPem = signer.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const otherPublicPem = other.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const grant = signVkCommunityOwnerGrant(buildAssertion(), signer.privateKey);

  const cases = [
    {
      grant: {
        ...grant,
        assertion: {
          ...grant.assertion,
          preview_fingerprint: 'b'.repeat(64),
        },
      },
      key: signerPublicPem,
      now: NOW,
    },
    {
      grant,
      key: otherPublicPem,
      now: NOW,
    },
    {
      grant,
      key: signerPublicPem,
      now: new Date('2026-08-27T07:03:00.000Z'),
    },
  ];

  for (const item of cases) {
    assert.throws(
      () =>
        verifyVkCommunityOwnerGrant({
          grant: item.grant,
          ownerApprovalPublicKey: item.key,
          publicationId: PUBLICATION_ID,
          ownerId: OWNER_ID,
          previewFingerprint: PREVIEW_FINGERPRINT,
          now: item.now,
        }),
      VkCommunityOwnerGrantError,
    );
  }
});

test('offline signer rejects malformed or overlong assertions before signing', () => {
  const { privateKey } = generateKeyPairSync('ed25519');

  assert.throws(
    () =>
      createVkCommunityOwnerGrantAssertion({
        grantId: 123 as unknown as string,
        publicationId: PUBLICATION_ID,
        ownerId: OWNER_ID,
        previewFingerprint: PREVIEW_FINGERPRINT,
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      }),
    VkCommunityOwnerGrantError,
  );

  assert.throws(
    () =>
      signVkCommunityOwnerGrant(
        {
          ...buildAssertion(),
          issued_at: '2026-08-27T07:00:00.000Z',
          expires_at: '2026-08-27T07:06:00.001Z',
        },
        privateKey,
      ),
    VkCommunityOwnerGrantError,
  );
});

test('owner signer accepts only an Ed25519 private KeyObject', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(
    () => signVkCommunityOwnerGrant(buildAssertion(), rsa.privateKey),
    VkCommunityOwnerGrantError,
  );
});
