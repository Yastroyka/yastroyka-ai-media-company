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

export type EngineeringCheckConclusion = 'passed' | 'failed' | 'not_run';

export interface EngineeringCheckEvidence {
  readonly name: string;
  readonly conclusion: EngineeringCheckConclusion;
}

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
  readonly validationEvidence: readonly EngineeringCheckEvidence[];
  readonly modelSelection: EngineeringModelSelection | null;
  readonly pullRequest: EngineeringPullRequestEvidence | null;
  readonly blockerReason: string | null;
}

export type EngineeringRunEvent =
  | { readonly type: 'MODEL_SELECTED'; readonly selection: EngineeringModelSelection }
  | { readonly type: 'START' }
  | { readonly type: 'IMPLEMENTATION_READY' }
  | { readonly type: 'VALIDATION_FAILED'; readonly reason: string }
  | {
      readonly type: 'VALIDATION_PASSED';
      readonly checks: readonly EngineeringCheckEvidence[];
    }
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

function validateModelSelection(selection: EngineeringModelSelection): EngineeringModelSelection {
  requireIdentifier(selection.provider, 'modelSelection.provider');
  requireIdentifier(selection.model, 'modelSelection.model');
  requireIdentifier(selection.whyThisModel, 'modelSelection.whyThisModel');

  const uniqueFallbackProviders = new Set<string>();
  for (const provider of selection.fallbackProviders) {
    requireIdentifier(provider, 'modelSelection.fallbackProvider');
    if (uniqueFallbackProviders.has(provider)) {
      throw new Error(`modelSelection contains a duplicate fallback provider: ${provider}.`);
    }
    uniqueFallbackProviders.add(provider);
  }

  return {
    ...selection,
    fallbackProviders: [...selection.fallbackProviders],
  };
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

  if (
    !Number.isInteger(envelope.maxAttempts) ||
    envelope.maxAttempts < 1 ||
    envelope.maxAttempts > 5
  ) {
    throw new Error('maxAttempts must be an integer between 1 and 5.');
  }

  if (envelope.requiredChecks.length === 0) {
    throw new Error('At least one required validation check is required.');
  }

  const uniqueChecks = new Set<string>();
  for (const check of envelope.requiredChecks) {
    requireIdentifier(check, 'requiredCheck');
    if (uniqueChecks.has(check)) {
      throw new Error(`requiredChecks contains a duplicate check: ${check}.`);
    }
    uniqueChecks.add(check);
  }

  if (envelope.modelSelection !== null) {
    validateModelSelection(envelope.modelSelection);
  }
}

function validatePassedChecks(
  requiredChecks: readonly string[],
  checks: readonly EngineeringCheckEvidence[],
): readonly EngineeringCheckEvidence[] {
  const evidenceByName = new Map<string, EngineeringCheckEvidence>();

  for (const check of checks) {
    requireIdentifier(check.name, 'check.name');
    if (evidenceByName.has(check.name)) {
      throw new Error(`Validation evidence contains a duplicate check: ${check.name}.`);
    }
    evidenceByName.set(check.name, check);
  }

  for (const requiredCheck of requiredChecks) {
    const evidence = evidenceByName.get(requiredCheck);
    if (evidence === undefined) {
      throw new Error(`Required validation check has no evidence: ${requiredCheck}.`);
    }
    if (evidence.conclusion !== 'passed') {
      throw new Error(
        `Required validation check ${requiredCheck} cannot be reported as PASS with conclusion ${evidence.conclusion}.`,
      );
    }
  }

  return checks.map((check) => ({ ...check }));
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

export function assertAutonomousEngineeringActionAllowed(
  action: AutonomousEngineeringAction,
): void {
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
      validationEvidence: [],
      modelSelection:
        envelope.modelSelection === null ? null : validateModelSelection(envelope.modelSelection),
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
        if (event.type === 'MODEL_SELECTED') {
          if (this.#state.modelSelection !== null) {
            throw new Error('Engineering run already has an approved model selection.');
          }
          return this.#replace({ modelSelection: validateModelSelection(event.selection) });
        }

        if (event.type === 'START') {
          if (this.#state.modelSelection === null) {
            throw new Error('Engineering run cannot start without an approved model selection.');
          }
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
          const validationEvidence = validatePassedChecks(this.#state.requiredChecks, event.checks);
          return this.#replace({ status: 'reviewing', validationEvidence });
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
      validationEvidence: [],
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
        | 'status'
        | 'decisionState'
        | 'attempt'
        | 'validationEvidence'
        | 'modelSelection'
        | 'pullRequest'
        | 'blockerReason'
      >
    >,
  ): EngineeringRunState {
    this.#state = { ...this.#state, ...patch };
    return this.state;
  }
}
