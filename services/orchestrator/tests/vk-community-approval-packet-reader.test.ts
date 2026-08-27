import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  VkCommunityPublishingError,
  computeVkCommunityPreviewFingerprint,
  type VkCommunityPublicationRecord,
  type VkCommunityPublicationStatePort,
} from '../src/adapters/vk-community-publishing-adapter.ts';
import { VkCommunityApprovalPacketReader } from '../src/vk-community-approval-packet-reader.ts';

const PUBLICATION_ID = '77777777-7777-4777-8777-777777777777';

function publication(
  overrides: Partial<VkCommunityPublicationRecord> = {},
): VkCommunityPublicationRecord {
  return {
    publicationId: PUBLICATION_ID,
    platform: 'VK_COMMUNITY',
    status: 'AUTO',
    payload: {
      vk_community: {
        message: 'Точный текст первого поста Ястройки',
      },
      publishing: {
        mode: 'AUTO',
      },
    },
    ...overrides,
  };
}

function stateWith(record: VkCommunityPublicationRecord | null): VkCommunityPublicationStatePort {
  return {
    async findById() {
      return record;
    },
  };
}

function expectCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof VkCommunityPublishingError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  };
}

test('approval packet is deterministic and contains only the exact canonical preview and fingerprint', async () => {
  const reader = new VkCommunityApprovalPacketReader({
    communityId: 123456,
    publicationState: stateWith(publication()),
  });

  const first = await reader.prepare(PUBLICATION_ID);
  const second = await reader.prepare(PUBLICATION_ID);

  const expectedIdempotencyKey = createHash('sha256').update(PUBLICATION_ID, 'utf8').digest('hex');
  assert.deepEqual(first, second);
  assert.deepEqual(first.preview, {
    publicationId: PUBLICATION_ID,
    platform: 'VK_COMMUNITY',
    ownerId: -123456,
    fromGroup: true,
    message: 'Точный текст первого поста Ястройки',
    idempotencyKey: expectedIdempotencyKey,
  });
  assert.equal(first.previewFingerprint, computeVkCommunityPreviewFingerprint(first.preview));
  assert.match(first.previewFingerprint, /^[0-9a-f]{64}$/u);
  assert.deepEqual(Object.keys(first).sort(), ['preview', 'previewFingerprint']);
  assert.doesNotMatch(
    JSON.stringify(first),
    /access[_-]?token|private key|password|credential|hmac|secret/iu,
  );
});

test('approval fingerprint is bound to the deployment destination', async () => {
  const first = new VkCommunityApprovalPacketReader({
    communityId: 123456,
    publicationState: stateWith(publication()),
  });
  const second = new VkCommunityApprovalPacketReader({
    communityId: 654321,
    publicationState: stateWith(publication()),
  });

  const firstPacket = await first.prepare(PUBLICATION_ID);
  const secondPacket = await second.prepare(PUBLICATION_ID);

  assert.equal(firstPacket.preview.ownerId, -123456);
  assert.equal(secondPacket.preview.ownerId, -654321);
  assert.notEqual(firstPacket.previewFingerprint, secondPacket.previewFingerprint);
});

test('approval packet fails closed for missing, wrong-platform, non-AUTO and malformed state', async () => {
  const cases: readonly [
    VkCommunityPublicationRecord | null,
    string,
  ][] = [
    [null, 'VK_PUBLICATION_NOT_FOUND'],
    [publication({ platform: 'MAX' }), 'VK_PUBLICATION_INVALID'],
    [publication({ status: 'APPROVED' }), 'VK_PUBLICATION_NOT_AUTO'],
    [
      publication({
        payload: {
          vk_community: {
            message: 'ok',
            token: 'must-not-be-accepted',
          },
        },
      }),
      'VK_PUBLICATION_INVALID',
    ],
  ];

  for (const [record, code] of cases) {
    const reader = new VkCommunityApprovalPacketReader({
      communityId: 123456,
      publicationState: stateWith(record),
    });
    await assert.rejects(() => reader.prepare(PUBLICATION_ID), expectCode(code));
  }
});

test('approval packet sanitizes canonical-state read failures', async () => {
  const publicationState: VkCommunityPublicationStatePort = {
    async findById() {
      throw new Error('database failed with credential=must-not-leak');
    },
  };
  const reader = new VkCommunityApprovalPacketReader({
    communityId: 123456,
    publicationState,
  });

  await assert.rejects(async () => {
    try {
      await reader.prepare(PUBLICATION_ID);
    } catch (error) {
      assert.doesNotMatch(JSON.stringify(error), /must-not-leak/u);
      throw error;
    }
  }, expectCode('VK_PUBLICATION_READ_FAILED'));
});
