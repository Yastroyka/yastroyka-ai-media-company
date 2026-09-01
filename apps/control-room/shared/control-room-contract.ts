export const CONTROL_ROOM_OVERVIEW_PATH = '/v1/control-room/overview' as const;

export const CONTROL_ROOM_WORKSPACE_IDS = ['VK_COMMUNITY', 'VK_VIDEO', 'MAX'] as const;

export const CONTROL_ROOM_OPERATIONAL_STATES = [
  'HEALTHY',
  'DEGRADED',
  'BLOCKED',
  'UNKNOWN',
] as const;

export type ControlRoomWorkspaceId = (typeof CONTROL_ROOM_WORKSPACE_IDS)[number];
export type ControlRoomOperationalState = (typeof CONTROL_ROOM_OPERATIONAL_STATES)[number];

export interface ControlRoomApprovalSummary {
  state: ControlRoomOperationalState;
  waitingCount: number;
  oldestWaitingAt: string | null;
}

export interface ControlRoomIncidentSummary {
  state: ControlRoomOperationalState;
  openCount: number;
  criticalCount: number;
  newestIncidentAt: string | null;
}

export interface ControlRoomWorkspaceSummary {
  workspaceId: ControlRoomWorkspaceId;
  state: ControlRoomOperationalState;
  activePublicationId: string | null;
  nextAction: string | null;
  observedAt: string;
}

export interface ControlRoomModelDecisionSummary {
  state: ControlRoomOperationalState;
  requestId: string | null;
  winnerModelId: string | null;
  provider: string | null;
  whyThisModel: string | null;
  decidedAt: string | null;
}

export interface ControlRoomOverviewData {
  source: 'YASTROYKA_OWNED_BACKEND';
  generatedAt: string;
  approvals: ControlRoomApprovalSummary;
  incidents: ControlRoomIncidentSummary;
  workspaces: ControlRoomWorkspaceSummary[];
  modelDecision: ControlRoomModelDecisionSummary;
}

export interface ControlRoomReadyEnvelope {
  status: 'READY';
  data: ControlRoomOverviewData;
}

export interface ControlRoomUnavailableEnvelope {
  status: 'UNAVAILABLE';
  reasonCode:
    | 'CONTROL_ROOM_BACKEND_NOT_CONFIGURED'
    | 'CONTROL_ROOM_BACKEND_CONFIGURATION_INVALID'
    | 'CONTROL_ROOM_BACKEND_UNREACHABLE'
    | 'CONTROL_ROOM_BACKEND_REJECTED_REQUEST'
    | 'CONTROL_ROOM_BACKEND_RESPONSE_INVALID';
  observedAt: string | null;
  data: null;
}

export type ControlRoomOverviewEnvelope = ControlRoomReadyEnvelope | ControlRoomUnavailableEnvelope;

const workspaceIds = new Set<string>(CONTROL_ROOM_WORKSPACE_IDS);
const operationalStates = new Set<string>(CONTROL_ROOM_OPERATIONAL_STATES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();

  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isOperationalState(value: unknown): value is ControlRoomOperationalState {
  return typeof value === 'string' && operationalStates.has(value);
}

function isApprovalSummary(value: unknown): value is ControlRoomApprovalSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasExactKeys(value, ['state', 'waitingCount', 'oldestWaitingAt']) &&
    isOperationalState(value.state) &&
    isNonNegativeInteger(value.waitingCount) &&
    (value.oldestWaitingAt === null || isTimestamp(value.oldestWaitingAt))
  );
}

function isIncidentSummary(value: unknown): value is ControlRoomIncidentSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasExactKeys(value, ['state', 'openCount', 'criticalCount', 'newestIncidentAt']) &&
    isOperationalState(value.state) &&
    isNonNegativeInteger(value.openCount) &&
    isNonNegativeInteger(value.criticalCount) &&
    value.criticalCount <= value.openCount &&
    (value.newestIncidentAt === null || isTimestamp(value.newestIncidentAt))
  );
}

function isWorkspaceSummary(value: unknown): value is ControlRoomWorkspaceSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasExactKeys(value, [
      'workspaceId',
      'state',
      'activePublicationId',
      'nextAction',
      'observedAt',
    ]) &&
    typeof value.workspaceId === 'string' &&
    workspaceIds.has(value.workspaceId) &&
    isOperationalState(value.state) &&
    isNullableString(value.activePublicationId) &&
    isNullableString(value.nextAction) &&
    isTimestamp(value.observedAt)
  );
}

function isModelDecisionSummary(value: unknown): value is ControlRoomModelDecisionSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasExactKeys(value, [
      'state',
      'requestId',
      'winnerModelId',
      'provider',
      'whyThisModel',
      'decidedAt',
    ]) &&
    isOperationalState(value.state) &&
    isNullableString(value.requestId) &&
    isNullableString(value.winnerModelId) &&
    isNullableString(value.provider) &&
    isNullableString(value.whyThisModel) &&
    (value.decidedAt === null || isTimestamp(value.decidedAt))
  );
}

function isOverviewData(value: unknown): value is ControlRoomOverviewData {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasExactKeys(value, [
      'source',
      'generatedAt',
      'approvals',
      'incidents',
      'workspaces',
      'modelDecision',
    ]) &&
    value.source === 'YASTROYKA_OWNED_BACKEND' &&
    isTimestamp(value.generatedAt) &&
    isApprovalSummary(value.approvals) &&
    isIncidentSummary(value.incidents) &&
    Array.isArray(value.workspaces) &&
    value.workspaces.length <= CONTROL_ROOM_WORKSPACE_IDS.length &&
    value.workspaces.every(isWorkspaceSummary) &&
    new Set(value.workspaces.map((workspace) => workspace.workspaceId)).size ===
      value.workspaces.length &&
    isModelDecisionSummary(value.modelDecision)
  );
}

export function isControlRoomReadyEnvelope(value: unknown): value is ControlRoomReadyEnvelope {
  if (!isRecord(value) || value.status !== 'READY') {
    return false;
  }

  return hasExactKeys(value, ['status', 'data']) && isOverviewData(value.data);
}

export function createUnavailableControlRoomOverview(
  reasonCode: ControlRoomUnavailableEnvelope['reasonCode'],
  observedAt: string | null = null,
): ControlRoomUnavailableEnvelope {
  return {
    status: 'UNAVAILABLE',
    reasonCode,
    observedAt,
    data: null,
  };
}
