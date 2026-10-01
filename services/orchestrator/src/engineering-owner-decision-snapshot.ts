import type {
  EngineeringCheckEvidence,
  EngineeringDecisionState,
  EngineeringModelSelection,
  EngineeringPullRequestEvidence,
  EngineeringRiskClass,
  EngineeringRunState,
  EngineeringRunStatus,
} from './engineering-run.ts';

export const ENGINEERING_OWNER_DECISION_SCHEMA_VERSION = 'engineering-owner-decision/v1' as const;

export interface EngineeringOwnerDecisionSnapshot {
  readonly schemaVersion: typeof ENGINEERING_OWNER_DECISION_SCHEMA_VERSION;
  readonly observedAt: string;
  readonly run: {
    readonly runId: string;
    readonly taskId: string;
    readonly status: EngineeringRunStatus;
    readonly decisionState: EngineeringDecisionState;
    readonly riskClass: EngineeringRiskClass;
    readonly attempt: number;
    readonly maxAttempts: number;
    readonly baseSha: string;
    readonly branch: string;
  };
  readonly modelSelection: EngineeringModelSelection | null;
  readonly validation: {
    readonly requiredChecks: readonly string[];
    readonly evidence: readonly EngineeringCheckEvidence[];
  };
  readonly pullRequest: EngineeringPullRequestEvidence | null;
  readonly blockerReason: string | null;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const INVALID_SNAPSHOT = 'invalid engineering owner decision snapshot';

function failClosed(): never {
  throw new Error(INVALID_SNAPSHOT);
}

function isCanonicalTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function hasExactPassedValidation(state: EngineeringRunState): boolean {
  if (state.requiredChecks.length === 0) {
    return false;
  }

  const evidenceByName = new Map<string, EngineeringCheckEvidence>();
  for (const evidence of state.validationEvidence) {
    if (evidenceByName.has(evidence.name)) {
      return false;
    }
    evidenceByName.set(evidence.name, evidence);
  }

  return state.requiredChecks.every(
    (requiredCheck) => evidenceByName.get(requiredCheck)?.conclusion === 'passed',
  );
}

function assertOwnerDecisionConsistency(state: EngineeringRunState, observedAt: string): void {
  if (!isCanonicalTimestamp(observedAt)) {
    failClosed();
  }

  const claimsOwnerReady =
    state.status === 'ready_for_owner_decision' ||
    state.decisionState === 'READY_FOR_OWNER_DECISION';

  if (claimsOwnerReady) {
    const pullRequest = state.pullRequest;
    if (
      state.status !== 'ready_for_owner_decision' ||
      state.decisionState !== 'READY_FOR_OWNER_DECISION' ||
      state.modelSelection === null ||
      pullRequest === null ||
      !Number.isInteger(pullRequest.number) ||
      pullRequest.number < 1 ||
      !SHA_PATTERN.test(pullRequest.headSha) ||
      pullRequest.draft !== true ||
      state.blockerReason !== null ||
      !hasExactPassedValidation(state)
    ) {
      failClosed();
    }
    return;
  }

  const claimsBlocked = state.status === 'blocked' || state.decisionState === 'BLOCKED';
  if (claimsBlocked) {
    if (
      state.status !== 'blocked' ||
      state.decisionState !== 'BLOCKED' ||
      state.blockerReason === null ||
      state.blockerReason.trim().length === 0
    ) {
      failClosed();
    }
    return;
  }

  if (state.decisionState !== 'PENDING' || state.blockerReason !== null) {
    failClosed();
  }
}

function cloneModelSelection(
  selection: EngineeringModelSelection | null,
): EngineeringModelSelection | null {
  if (selection === null) {
    return null;
  }

  return {
    ...selection,
    fallbackProviders: [...selection.fallbackProviders],
  };
}

export function createEngineeringOwnerDecisionSnapshot(
  state: EngineeringRunState,
  observedAt: string,
): EngineeringOwnerDecisionSnapshot {
  assertOwnerDecisionConsistency(state, observedAt);

  return {
    schemaVersion: ENGINEERING_OWNER_DECISION_SCHEMA_VERSION,
    observedAt,
    run: {
      runId: state.runId,
      taskId: state.taskId,
      status: state.status,
      decisionState: state.decisionState,
      riskClass: state.riskClass,
      attempt: state.attempt,
      maxAttempts: state.maxAttempts,
      baseSha: state.baseSha,
      branch: state.branch,
    },
    modelSelection: cloneModelSelection(state.modelSelection),
    validation: {
      requiredChecks: [...state.requiredChecks],
      evidence: state.validationEvidence.map((check) => ({ ...check })),
    },
    pullRequest: state.pullRequest === null ? null : { ...state.pullRequest },
    blockerReason: state.blockerReason,
  };
}
