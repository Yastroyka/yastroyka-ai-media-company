import assert from 'node:assert/strict';
import test from 'node:test';

import type { PublicationDiscoveryRecord } from '@yastroyka/db';

import {
  inspectVkCommunityActivationReadiness,
  type VkCommunityActivationReadinessSource,
} from '../src/vk-community-activation-readiness.ts';
import { runVkCommunityActivationReadiness } from '../src/vk-community-activation-readiness-cli.ts';
import type { VkCommunityReadOnlyPublicationDiscoveryLease } from '../src/vk-community-read-only-state.ts';

const AUTO_PUBLICATION_ID = '00000000-0000-4000-8000-000000000241';
const DRAFT_PUBLICATION_ID = '00000000-0000-4000-8000-000000000242';
const MASTER_CONTENT_ID = '00000000-0000-4000-8000-000000000240';

function record(
  publicationId: string,
  status: PublicationDiscoveryRecord['status'],
): PublicationDiscoveryRecord {
  return {
    publicationId,
    masterContentId: MASTER_CONTENT_ID,
    workspaceId: 'yastroyka-vk-community',
    platform: 'VK_COMMUNITY',
    status,
    createdAt: '2026-09-01T12:00:00.000Z',
    publishedAt: null,
  };
}

function source(
  records: readonly PublicationDiscoveryRecord[],
): VkCommunityActivationReadinessSource {
  return {
    async listRecentByPlatform(platform, limit) {
      assert.equal(platform, 'VK_COMMUNITY');
      assert.equal(limit, 20);
      return records;
    },
  };
}

test('AUTO publication is reported only as a rehearsal candidate without payload leakage', async () => {
  const unsafeInput = {
    ...record(AUTO_PUBLICATION_ID, 'AUTO'),
    payload: {
      token: 'must-never-enter-readiness-output',
      text: 'must-never-enter-readiness-output',
    },
  } as PublicationDiscoveryRecord;

  const result = await inspectVkCommunityActivationReadiness(
    source([unsafeInput, record(DRAFT_PUBLICATION_ID, 'DRAFT')]),
  );

  assert.equal(result.status, 'CANDIDATE_FOUND');
  assert.equal(result.nextGate, 'VK_RELEASE_REHEARSAL_REQUIRED');
  assert.deepEqual(
    result.autoCandidates.map((candidate) => candidate.publicationId),
    [AUTO_PUBLICATION_ID],
  );
  assert.equal(result.guarantees.productionReadyClaim, false);
  assert.equal(result.guarantees.publicationPayloadRead, false);
  assert.equal(
    result.recent.some((candidate) => Object.hasOwn(candidate, 'payload')),
    false,
  );
  assert.equal(
    result.autoCandidates.some((candidate) => Object.hasOwn(candidate, 'payload')),
    false,
  );
  assert.doesNotMatch(JSON.stringify(result), /must-never-enter-readiness-output/u);
});

test('no AUTO publication blocks with a fixed preparation reason', async () => {
  const result = await inspectVkCommunityActivationReadiness(
    source([record(DRAFT_PUBLICATION_ID, 'DRAFT')]),
  );

  assert.deepEqual(result, {
    status: 'BLOCKED',
    stage: 'PUBLICATION_DISCOVERY',
    platform: 'VK_COMMUNITY',
    reason: 'NO_AUTO_REHEARSAL_CANDIDATE',
    inspectedCount: 1,
    autoCandidates: [],
    recent: [record(DRAFT_PUBLICATION_ID, 'DRAFT')],
    nextGate: 'CANONICAL_PUBLICATION_PREPARATION_REQUIRED',
    guarantees: {
      readOnly: true,
      publicationPayloadRead: false,
      secretMaterialAccess: false,
      networkAccess: false,
      productionWrite: false,
      productionReadyClaim: false,
    },
  });
});

test('unexpected platform from discovery fails closed', async () => {
  const wrongPlatform = {
    ...record(AUTO_PUBLICATION_ID, 'AUTO'),
    platform: 'VK_VIDEO',
  } as PublicationDiscoveryRecord;

  await assert.rejects(
    inspectVkCommunityActivationReadiness(source([wrongPlatform])),
    /unexpected platform/u,
  );
});

test('CLI usage error opens no database', async () => {
  let opened = false;
  let stderr = '';

  const exitCode = await runVkCommunityActivationReadiness(
    [],
    {
      async openPublicationDiscovery() {
        opened = true;
        throw new Error('must not open');
      },
    },
    {
      writeStdout() {},
      writeStderr(text) {
        stderr += text;
      },
    },
  );

  assert.equal(exitCode, 64);
  assert.equal(opened, false);
  assert.equal(stderr, 'Usage: vk:activation-readiness\n');
});

test('CLI closes read-only lease before emitting candidate output', async () => {
  const events: string[] = [];
  let stdout = '';

  const lease: VkCommunityReadOnlyPublicationDiscoveryLease = {
    publicationDiscovery: {
      async listRecentByPlatform() {
        events.push('query');
        return [record(AUTO_PUBLICATION_ID, 'AUTO')];
      },
    },
    async close() {
      events.push('close');
    },
  };

  const exitCode = await runVkCommunityActivationReadiness(
    ['activation-readiness'],
    {
      async openPublicationDiscovery() {
        events.push('open');
        return lease;
      },
    },
    {
      writeStdout(text) {
        events.push('stdout');
        stdout += text;
      },
      writeStderr() {},
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(events, ['open', 'query', 'close', 'stdout']);
  assert.match(stdout, /CANDIDATE_FOUND/u);
  assert.match(stdout, new RegExp(AUTO_PUBLICATION_ID, 'u'));
});

test('CLI database failures are generic and do not reflect raw errors', async () => {
  let stderr = '';

  const exitCode = await runVkCommunityActivationReadiness(
    ['activation-readiness'],
    {
      async openPublicationDiscovery() {
        throw new Error('password=super-secret-database-value');
      },
    },
    {
      writeStdout() {},
      writeStderr(text) {
        stderr += text;
      },
    },
  );

  assert.equal(exitCode, 70);
  assert.equal(stderr, 'VK activation readiness failed\n');
  assert.doesNotMatch(stderr, /super-secret-database-value/u);
});
