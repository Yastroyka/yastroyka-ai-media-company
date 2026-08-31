import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createUnavailableControlRoomOverview,
  isControlRoomReadyEnvelope,
} from '../shared/control-room-contract.ts';

const NOW = '2026-08-31T18:00:00.000Z';

function validReadyEnvelope(): unknown {
  return {
    status: 'READY',
    data: {
      source: 'YASTROYKA_OWNED_BACKEND',
      generatedAt: NOW,
      approvals: {
        state: 'HEALTHY',
        waitingCount: 1,
        oldestWaitingAt: NOW,
      },
      incidents: {
        state: 'DEGRADED',
        openCount: 2,
        criticalCount: 1,
        newestIncidentAt: NOW,
      },
      workspaces: [
        {
          workspaceId: 'VK_COMMUNITY',
          state: 'HEALTHY',
          activePublicationId: null,
          nextAction: 'REVIEW',
          observedAt: NOW,
        },
        {
          workspaceId: 'VK_VIDEO',
          state: 'UNKNOWN',
          activePublicationId: null,
          nextAction: null,
          observedAt: NOW,
        },
        {
          workspaceId: 'MAX',
          state: 'BLOCKED',
          activePublicationId: 'publication-1',
          nextAction: 'OWNER_APPROVAL',
          observedAt: NOW,
        },
      ],
      modelDecision: {
        state: 'HEALTHY',
        requestId: 'route-1',
        winnerModelId: 'model-1',
        provider: 'provider-1',
        whyThisModel: 'Selected by canonical Model Exchange hard gates.',
        decidedAt: NOW,
      },
    },
  };
}

test('accepts an exact owned-backend overview envelope', () => {
  assert.equal(isControlRoomReadyEnvelope(validReadyEnvelope()), true);
});

test('rejects unknown top-level fields and fake source authority', () => {
  const withUnknownField = {
    ...(validReadyEnvelope() as Record<string, unknown>),
    token: 'must-not-be-accepted',
  };
  assert.equal(isControlRoomReadyEnvelope(withUnknownField), false);

  const wrongSource = validReadyEnvelope() as {
    data: { source: string };
  };
  wrongSource.data.source = 'BROWSER_MOCK';
  assert.equal(isControlRoomReadyEnvelope(wrongSource), false);
});

test('rejects malformed counts, timestamps, and duplicate workspaces', () => {
  const malformed = validReadyEnvelope() as {
    data: {
      incidents: { openCount: number; criticalCount: number };
      workspaces: Array<Record<string, unknown>>;
    };
  };

  malformed.data.incidents.openCount = 1;
  malformed.data.incidents.criticalCount = 2;
  malformed.data.workspaces.push({ ...malformed.data.workspaces[0] });

  assert.equal(isControlRoomReadyEnvelope(malformed), false);
});

test('creates a sanitized unavailable envelope without raw error text', () => {
  assert.deepEqual(
    createUnavailableControlRoomOverview(
      'CONTROL_ROOM_BACKEND_UNREACHABLE',
      NOW,
    ),
    {
      status: 'UNAVAILABLE',
      reasonCode: 'CONTROL_ROOM_BACKEND_UNREACHABLE',
      observedAt: NOW,
      data: null,
    },
  );
});
