import assert from 'node:assert/strict';
import test from 'node:test';

import { createControlRoomOverview } from '../src/control-room-overview.ts';

const NOW = '2026-10-01T02:00:00.000Z';

test('TASK-027 creates a bounded owner overview without fabricating incident counts', async () => {
  const overview = await createControlRoomOverview({
    now: () => new Date(NOW),
    approvals: {
      getPendingSummary: async () => ({
        waitingCount: 2,
        oldestWaitingAt: '2026-09-30T20:00:00.000Z',
      }),
    },
    engineering: {
      findLatest: async () => null,
    },
    modelDecision: {
      findLatest: async () => null,
    },
    publications: {
      listRecentByPlatform: async () => [],
    },
  });

  assert.equal(overview.status, 'READY');
  assert.equal(overview.data.source, 'YASTROYKA_OWNED_BACKEND');
  assert.equal(overview.data.generatedAt, NOW);
  assert.deepEqual(overview.data.approvals, {
    state: 'DEGRADED',
    waitingCount: 2,
    oldestWaitingAt: '2026-09-30T20:00:00.000Z',
  });
  assert.deepEqual(overview.data.incidents, {
    state: 'UNKNOWN',
    openCount: null,
    criticalCount: null,
    newestIncidentAt: null,
  });
  assert.equal(overview.data.workspaces.length, 3);
  assert.deepEqual(
    overview.data.workspaces.map((workspace) => workspace.workspaceId),
    ['VK_COMMUNITY', 'VK_VIDEO', 'MAX'],
  );
  assert.deepEqual(overview.data.modelDecision, {
    state: 'UNKNOWN',
    requestId: null,
    winnerModelId: null,
    provider: null,
    whyThisModel: null,
    decidedAt: null,
  });
});
