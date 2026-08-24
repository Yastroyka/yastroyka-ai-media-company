export type EngineeringRiskClass = 'R0' | 'R1' | 'R2' | 'R3';

export type EngineeringRunStatus =
  | 'approved'
  | 'executing'
  | 'validating'
  | 'reviewing'
  | 'draft_pr_pending'
  | 'awaiting_ci'
  | 'ready_for_owner_decision'
  | 'blocked';

export type EngineeringDecisionState = 'PENDING' | 'READY_FOR_OWNER_DECISION' | 'BLOCKED';

export interface EngineeringModelSelection {
  readonly provider: string;
  readonly model: string;
  readonly whyThisModel: string;
  readonly fallbackProviders: readonly string[];
}

export interface EngineeringTaskEnvelope {
  readonly runId: string;
  readonly taskId: string;
  readonly objective: string;
  readonly baseSha: string;
  readonly branch: string;
  readonly riskClass: EngineeringRiskClass;
  readonly maxAttempts: number;
  readonly requiredChecks: readonly string[];
  readonly modelSelection: EngineeringModelSelection | null;
}

export interface EngineeringPullRequestEvidence {
  readonly number: number;
  readonly headSha: string;
  readonly draft: true;
}

export interface EngineeringRunState {
  readonly runId: string;
  readonly taskId: string;
  readonly baseSha: string;
  readonly branch: string;
  readonly riskClass: EngineeringRiskClass;
  readonly status: EngineeringRunStatus;
  readonly decisionState: EngineeringDecisionState;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly requiredChecks: readonly string[];
  readonly modelSelection: EngineeringModelSelection | null;
  readonly pullRequest: EngineeringPullRequestEvidence | null;
  readonly blockerReason: string | null;
}

export type EngineeringRunEvent =
  | { readonly type: 'START' }
  | { readonly type: 'IMPLEMENTATION_READY' }
  | { readonly type: 'VALIDATION_FAILED'; readonly reason: string }
  | { readonly type: 'VALIDATION_PASSED' }
  | { readonly type: 'REVIEW_PASSED' }
  | {
      readonly type: 'DRAFT_PR_PUBLISHED';
      readonly prNumber: number;
      readonly headSha: string;
    }
  | { readonly type: 'CI_FAILED'; readonly headSha: string; readonly reason: string }
  | { readonly type: 'CI_PASSED'; readonly headSha: string }
  | { readonly type: 'BLOCK'; readonly reason: string };

export type AutonomousEngineeringAction =
  | 'read_main'
  | 'create_feature_branch'
  | 'run_validation'
  | 'push_feature_branch'
  | 'create_or_update_draft_pr'
  | 'observe_ci'
  | 'direct_main_push'
  | 'force_push'
  | 'merge_protected_branch'
  | 'mark_ready_for_review'
  | 'read_secret'
  | 'destructive_command'
  | 'production_write'
  | 'permission_expansion';

const ALLOWED_AUTONOMOUS_ACTIONS = new Set<AutonomousEngineeringAction>([
  'read_main',
  'create_feature_branch',
  'run_validation',
  'push_feature_branch',
  'create_or_update_draft_pr',
  'observe_ci',
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

function requireIdentifier(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty identifier.`);
  }
}

function requireSha(value: string, field: string): void {
  if (!SHA_PATTERN.test(value)) {
    throw new Error(`${field} must be an exact 40-character lowercase Git SHA.`);
  }
}

function requireReason(value: string): void {
  if (value.trim().length === 0) {
    throw new Error('reason must be non-empty.');
  }
}

function validateEnvelope(envelope: EngineeringTaskEnvelope): void {
  requireIdentifier(envelope.runId, 'runId');
  requireIdentifier(envelope.taskId, 'taskId');
  requireIdentifier(envelope.objective, 'objective');
  requireIdentifier(envelope.branch, 'branch');
  requireSha(envelope.baseSha, 'baseSha');

  if (envelope.branch === 'main' || envelope.branch === 'refs/heads/main') {
    throw new Error('Engineering runs must use an isolated feature branch, never main.');
  }

  if (!Number.isInteger(envelope.maxAttempts) || envelope.maxAttempts < 1 || envelope.maxAttempts > 5) {
    throw new Error('maxAttempts must be an integer between 1 and 5.');
  }

  if (envelope.requiredChecks.length === 0) {
    throw new Error('At least one required validation check is required.');
  }
}

export class EngineeringPolicyDeniedError extends Error {
  readonly action: AutonomousEngineeringAction;

  constructor(action: AutonomousEngineeringAction) {
    super(`Autonomous engineering action is denied by policy: ${action}.`);
    this.name = 'EngineeringPolicyDeniedError';
    this.action = action;
  }
}

export class EngineeringRunTransitionError extends Error {
  readonly status: EngineeringRunStatus;
  readonly event: EngineeringRunEvent['type'];

  constructor(status: EngineeringRunStatus, event: EngineeringRunEvent['type']) {
    super(`Engineering run event ${event} is invalid while status is ${status}.`);
    this.name = 'EngineeringRunTransitionError';
    this.status = status;
    this.event = event;
  }
}

export function assertAutonomousEngineeringActionAllowed(action: AutonomousEngineeringAction): void {
  if (!ALLOWED_AUTONOMOUS_ACTIONS.has(action)) {
    throw new EngineeringPolicyDeniedError(action);
  }
}

export class EngineeringRunStateMachine {
  #state: EngineeringRunState;

  constructor(envelope: EngineeringTaskEnvelope) {
    validateEnvelope(envelope);

    this.#state = {
      runId: envelope.runId,
      taskId: envelope.taskId,
      baseSha: envelope.baseSha,
      branch: envelope.branch,
      riskClass: envelope.riskClass,
      status: 'approved',
      decisionState: 'PENDING',
      attempt: 0,
      maxAttempts: envelope.maxAttempts,
      requiredChecks: [...envelope.requiredChecks],
      modelSelection:
        envelope.modelSelection === null
          ? null
          : {
              ...envelope.modelSelection,
              fallbackProviders: [...envelope.modelSelection.fallbackProviders],
            },
      pullRequest: null,
      blockerReason: null,
    };
  }

  get state(): EngineeringRunState {
    return structuredClone(this.#state);
  }

  apply(event: EngineeringRunEvent): EngineeringRunState {
    if (event.type === 'BLOCK') {
      requireReason(event.reason);
      return this.#block(event.reason);
    }

    switch (this.#state.status) {
      case 'approved':
        if (event.type === 'START') {
          return this.#replace({ status: 'executing', attempt: 1 });
        }
        break;

      case 'executing':
        if (event.type === 'IMPLEMENTATION_READY') {
          return this.#replace({ status: 'validating' });
        }
        break;

      case 'validating':
        if (event.type === 'VALIDATION_PASSED') {
          return this.#replace({ status: 'reviewing' });
        }

        if (event.type === 'VALIDATION_FAILED') {
          requireReason(event.reason);
          return this.#retryOrBlock(`Validation failed: ${event.reason}`);
        }
        break;

      case 'reviewing':
        if (event.type === 'REVIEW_PASSED') {
          return this.#replace({ status: 'draft_pr_pending' });
        }
        break;

      case 'draft_pr_pending':
        if (event.type === 'DRAFT_PR_PUBLISHED') {
          if (!Number.isInteger(event.prNumber) || event.prNumber < 1) {
            throw new Error('prNumber must be a positive integer.');
          }
          requireSha(event.headSha, 'headSha');

          return this.#replace({
            status: 'awaiting_ci',
            pullRequest: {
              number: event.prNumber,
              headSha: event.headSha,
              draft: true,
            },
          });
        }
        break;

      case 'awaiting_ci':
        if (event.type === 'CI_PASSED' || event.type === 'CI_FAILED') {
          requireSha(event.headSha, 'headSha');

          if (this.#state.pullRequest?.headSha !== event.headSha) {
            return this.#block(
              `CI evidence head SHA ${event.headSha} does not match Draft PR head ${this.#state.pullRequest?.headSha ?? 'missing'}.`,
            );
          }
        }

        if (event.type === 'CI_PASSED') {
          return this.#replace({
            status: 'ready_for_owner_decision',
            decisionState: 'READY_FOR_OWNER_DECISION',
          });
        }

        if (event.type === 'CI_FAILED') {
          requireReason(event.reason);
          return this.#retryOrBlock(`CI failed for exact head ${event.headSha}: ${event.reason}`);
        }
        break;

      case 'ready_for_owner_decision':
      case 'blocked':
        break;
    }

    throw new EngineeringRunTransitionError(this.#state.status, event.type);
  }

  #retryOrBlock(reason: string): EngineeringRunState {
    if (this.#state.attempt >= this.#state.maxAttempts) {
      return this.#block(`${reason}; retry budget exhausted.`);
    }

    return this.#replace({
      status: 'executing',
      attempt: this.#state.attempt + 1,
      decisionState: 'PENDING',
      blockerReason: null,
    });
  }

  #block(reason: string): EngineeringRunState {
    this.#state = {
      ...this.#state,
      status: 'blocked',
      decisionState: 'BLOCKED',
      blockerReason: reason,
    };

    return this.state;
  }

  #replace(
    patch: Partial<
      Pick<
        EngineeringRunState,
        'status' | 'decisionState' | 'attempt' | 'pullRequest' | 'blockerReason'
      >
    >,
  ): EngineeringRunState {
    this.#state = { ...this.#state, ...patch };
    return this.state;
  }
}
