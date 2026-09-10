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

function cloneModelSelection(selection: EngineeringModelSelection | null): EngineeringModelSelection | null {
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
