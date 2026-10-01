import type {
  DurableEngineeringEvidenceRecord,
  PendingApprovalSummary,
  PublicationDiscoveryRecord,
  PublicationPlatform,
} from '@yastroyka/db';

export const CONTROL_ROOM_WORKSPACE_IDS = ['VK_COMMUNITY', 'VK_VIDEO', 'MAX'] as const;

export type ControlRoomWorkspaceId = (typeof CONTROL_ROOM_WORKSPACE_IDS)[number];
export type ControlRoomOperationalState = 'HEALTHY' | 'DEGRADED' | 'BLOCKED' | 'UNKNOWN';

export interface ControlRoomOverviewSources {
  readonly now: () => Date;
  readonly approvals: {
    getPendingSummary(): Promise<PendingApprovalSummary>;
  };
  readonly engineering: {
    findLatest(): Promise<DurableEngineeringEvidenceRecord | null>;
  };
  readonly modelDecision: {
    findLatest(): Promise<RoutingDecisionTraceLike | null>;
  };
  readonly publications: {
    listRecentByPlatform(
      platform: PublicationPlatform,
      limit?: number,
    ): Promise<readonly PublicationDiscoveryRecord[]>;
  };
}

interface RoutingDecisionTraceLike {
  readonly request_id: string;
  readonly winner: {
    readonly model_id: string;
    readonly provider: string;
  };
  readonly why_this_model: string;
  readonly created_at: string;
}

export interface ControlRoomOverview {
  readonly status: 'READY';
  readonly data: {
    readonly source: 'YASTROYKA_OWNED_BACKEND';
    readonly generatedAt: string;
    readonly approvals: {
      readonly state: ControlRoomOperationalState;
      readonly waitingCount: number;
      readonly oldestWaitingAt: string | null;
    };
    readonly incidents: {
      readonly state: 'UNKNOWN';
      readonly openCount: null;
      readonly criticalCount: null;
      readonly newestIncidentAt: null;
    };
    readonly engineering: {
      readonly state: ControlRoomOperationalState;
      readonly runId: string | null;
      readonly eventType: string | null;
      readonly observedAt: string | null;
    };
    readonly workspaces: readonly {
      readonly workspaceId: ControlRoomWorkspaceId;
      readonly state: ControlRoomOperationalState;
      readonly activePublicationId: string | null;
      readonly nextAction: string | null;
      readonly observedAt: string;
    }[];
    readonly modelDecision: {
      readonly state: ControlRoomOperationalState;
      readonly requestId: string | null;
      readonly winnerModelId: string | null;
      readonly provider: string | null;
      readonly whyThisModel: string | null;
      readonly decidedAt: string | null;
    };
  };
}

function requireExactTimestamp(value: Date): string {
  const timestamp = value.toISOString();
  if (Number.isNaN(value.getTime())) {
    throw new Error('Control Room clock returned an invalid date.');
  }
  return timestamp;
}

function approvalState(summary: PendingApprovalSummary): ControlRoomOperationalState {
  return summary.waitingCount === 0 ? 'HEALTHY' : 'DEGRADED';
}

function publicationState(
  publication: PublicationDiscoveryRecord | undefined,
): ControlRoomOperationalState {
  if (publication === undefined) {
    return 'UNKNOWN';
  }

  if (publication.status === 'PUBLISHED') {
    return 'HEALTHY';
  }

  if (publication.status === 'FAILED') {
    return 'BLOCKED';
  }

  return 'DEGRADED';
}

function nextPublicationAction(
  publication: PublicationDiscoveryRecord | undefined,
): string | null {
  if (publication === undefined || publication.status === 'PUBLISHED') {
    return null;
  }

  if (publication.status === 'FAILED') {
    return 'REVIEW_FAILURE';
  }

  return 'REVIEW';
}

async function workspaceSummary(
  sources: ControlRoomOverviewSources,
  workspaceId: ControlRoomWorkspaceId,
  observedAt: string,
): Promise<ControlRoomOverview['data']['workspaces'][number]> {
  const publications = await sources.publications.listRecentByPlatform(workspaceId, 1);
  const publication = publications[0];

  return {
    workspaceId,
    state: publicationState(publication),
    activePublicationId: publication?.publicationId ?? null,
    nextAction: nextPublicationAction(publication),
    observedAt,
  };
}

export async function createControlRoomOverview(
  sources: ControlRoomOverviewSources,
): Promise<ControlRoomOverview> {
  const generatedAt = requireExactTimestamp(sources.now());

  const [approvals, engineering, modelDecision, ...workspaces] = await Promise.all([
    sources.approvals.getPendingSummary(),
    sources.engineering.findLatest(),
    sources.modelDecision.findLatest(),
    ...CONTROL_ROOM_WORKSPACE_IDS.map((workspaceId) =>
      workspaceSummary(sources, workspaceId, generatedAt),
    ),
  ]);

  return {
    status: 'READY',
    data: {
      source: 'YASTROYKA_OWNED_BACKEND',
      generatedAt,
      approvals: {
        state: approvalState(approvals),
        waitingCount: approvals.waitingCount,
        oldestWaitingAt: approvals.oldestWaitingAt,
      },
      incidents: {
        state: 'UNKNOWN',
        openCount: null,
        criticalCount: null,
        newestIncidentAt: null,
      },
      engineering: {
        state: engineering === null ? 'UNKNOWN' : 'HEALTHY',
        runId: engineering?.runId ?? null,
        eventType: engineering?.eventType ?? null,
        observedAt: engineering?.recordedAt ?? null,
      },
      workspaces,
      modelDecision:
        modelDecision === null
          ? {
              state: 'UNKNOWN',
              requestId: null,
              winnerModelId: null,
              provider: null,
              whyThisModel: null,
              decidedAt: null,
            }
          : {
              state: 'HEALTHY',
              requestId: modelDecision.request_id,
              winnerModelId: modelDecision.winner.model_id,
              provider: modelDecision.winner.provider,
              whyThisModel: modelDecision.why_this_model,
              decidedAt: modelDecision.created_at,
            },
    },
  };
}
