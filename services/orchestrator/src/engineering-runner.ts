import {
  EngineeringRunStateMachine,
  assertAutonomousEngineeringActionAllowed,
  type AutonomousEngineeringAction,
  type EngineeringCheckEvidence,
  type EngineeringModelSelection,
  type EngineeringRiskClass,
  type EngineeringRunState,
  type EngineeringTaskEnvelope,
} from './engineering-run.ts';

export interface EngineeringAuthorizationRequest {
  readonly action: AutonomousEngineeringAction;
  readonly runId: string;
  readonly riskClass: EngineeringRiskClass;
  readonly branch: string;
}

export interface EngineeringAuthorizationPort {
  assertAllowed(request: EngineeringAuthorizationRequest): Promise<void>;
}

export interface EngineeringWorkspace {
  readonly path: string;
  readonly branch: string;
  readonly baseSha: string;
}

export interface EngineeringWorkspacePort {
  prepare(envelope: EngineeringTaskEnvelope): Promise<EngineeringWorkspace>;
  readHead(workspace: EngineeringWorkspace): Promise<string>;
  pushFeatureBranch(workspace: EngineeringWorkspace, expectedHeadSha: string): Promise<void>;
  dispose(workspace: EngineeringWorkspace): Promise<void>;
}

export interface EngineeringModelCandidate {
  readonly provider: string;
  readonly model: string;
  readonly revision: string | null;
}

export interface EngineeringModelRoutingDecision {
  readonly winner: EngineeringModelCandidate;
  readonly fallbacks: readonly EngineeringModelCandidate[];
  readonly whyThisModel: string;
}

export interface EngineeringModelRoutingPort {
  route(envelope: EngineeringTaskEnvelope): Promise<EngineeringModelRoutingDecision>;
}

export class EngineeringProviderUnavailableError extends Error {
  constructor() {
    super('Engineering model provider is unavailable.');
    this.name = 'EngineeringProviderUnavailableError';
  }
}

export interface EngineeringWorkerInput {
  readonly envelope: EngineeringTaskEnvelope;
  readonly workspace: EngineeringWorkspace;
  readonly attempt: number;
  readonly correctionReason: string | null;
  readonly model: EngineeringModelCandidate;
}

export interface EngineeringWorkerPort {
  implement(input: EngineeringWorkerInput): Promise<void>;
}

export interface EngineeringValidationPort {
  validate(
    workspace: EngineeringWorkspace,
    requiredChecks: readonly string[],
  ): Promise<readonly EngineeringCheckEvidence[]>;
}

export interface EngineeringReviewResult {
  readonly passed: boolean;
  readonly reason: string | null;
}

export interface EngineeringReviewPort {
  review(workspace: EngineeringWorkspace, headSha: string): Promise<EngineeringReviewResult>;
}

export interface EngineeringDraftPullRequest {
  readonly number: number;
  readonly headSha: string;
  readonly draft: true;
}

export interface EngineeringDraftPullRequestInput {
  readonly branch: string;
  readonly baseBranch: 'main';
  readonly headSha: string;
  readonly title: string;
  readonly body: string;
}

export type EngineeringCiConclusion = 'success' | 'failure';

export interface EngineeringCiResult {
  readonly headSha: string;
  readonly conclusion: EngineeringCiConclusion;
  readonly reason: string | null;
}

export interface EngineeringGitHubPort {
  publishDraftPullRequest(
    input: EngineeringDraftPullRequestInput,
  ): Promise<EngineeringDraftPullRequest>;
  waitForCi(prNumber: number, expectedHeadSha: string): Promise<EngineeringCiResult>;
}

export type EngineeringEvidenceEventType =
  | 'model_selected'
  | 'model_fallback'
  | 'workspace_prepared'
  | 'implementation_completed'
  | 'validation_failed'
  | 'validation_passed'
  | 'review_passed'
  | 'feature_branch_pushed'
  | 'draft_pr_published'
  | 'ci_failed'
  | 'ci_passed'
  | 'blocked';

export interface EngineeringEvidencePayload {
  readonly state: EngineeringRunState;
  readonly headSha: string | null;
  readonly activeModel: EngineeringModelCandidate | null;
}

export interface EngineeringRunEvidenceRecord {
  readonly runId: string;
  readonly sequence: number;
  readonly eventType: EngineeringEvidenceEventType;
  readonly payload: EngineeringEvidencePayload;
  readonly recordedAt: string;
}

export interface EngineeringRunEvidencePort {
  record(record: EngineeringRunEvidenceRecord): Promise<void>;
}

export interface EngineeringRunnerDependencies {
  readonly authorization: EngineeringAuthorizationPort;
  readonly workspace: EngineeringWorkspacePort;
  readonly modelRouting: EngineeringModelRoutingPort;
  readonly worker: EngineeringWorkerPort;
  readonly validation: EngineeringValidationPort;
  readonly review: EngineeringReviewPort;
  readonly github: EngineeringGitHubPort;
  readonly evidence: EngineeringRunEvidencePort;
  readonly now?: () => Date;
}

export interface EngineeringRunnerResult {
  readonly state: EngineeringRunState;
  readonly workspace: EngineeringWorkspace | null;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

function requireSha(value: string, field: string): void {
  if (!SHA_PATTERN.test(value)) {
    throw new Error(`${field} must be an exact 40-character lowercase Git SHA.`);
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} must be non-empty.`);
  }
}

function requireWorkspace(
  workspace: EngineeringWorkspace,
  envelope: EngineeringTaskEnvelope,
): EngineeringWorkspace {
  if (workspace.path.trim().length === 0) {
    throw new Error('Engineering workspace path must be non-empty.');
  }

  if (workspace.branch !== envelope.branch) {
    throw new Error('Engineering workspace branch does not match the approved envelope.');
  }

  if (workspace.baseSha !== envelope.baseSha) {
    throw new Error('Engineering workspace base SHA does not match the approved envelope.');
  }

  return workspace;
}

function validationFailureReason(
  requiredChecks: readonly string[],
  checks: readonly EngineeringCheckEvidence[],
): string | null {
  const evidenceByName = new Map<string, EngineeringCheckEvidence>();

  for (const check of checks) {
    if (evidenceByName.has(check.name)) {
      return `Validation evidence contains duplicate check ${check.name}.`;
    }
    evidenceByName.set(check.name, check);
  }

  for (const requiredCheck of requiredChecks) {
    const evidence = evidenceByName.get(requiredCheck);
    if (evidence === undefined) {
      return `Required validation check did not run: ${requiredCheck}.`;
    }
    if (evidence.conclusion !== 'passed') {
      return `Required validation check ${requiredCheck} concluded ${evidence.conclusion}.`;
    }
  }

  return null;
}

function validateCandidate(
  candidate: EngineeringModelCandidate,
  field: string,
): EngineeringModelCandidate {
  requireNonEmpty(candidate.provider, `${field}.provider`);
  requireNonEmpty(candidate.model, `${field}.model`);
  if (candidate.revision !== null) {
    requireNonEmpty(candidate.revision, `${field}.revision`);
  }
  return { ...candidate };
}

function candidateKey(candidate: EngineeringModelCandidate): string {
  return `${candidate.provider}\u0000${candidate.model}\u0000${candidate.revision ?? ''}`;
}

function validateRoutingDecision(
  decision: EngineeringModelRoutingDecision,
): EngineeringModelRoutingDecision {
  requireNonEmpty(decision.whyThisModel, 'routingDecision.whyThisModel');
  const winner = validateCandidate(decision.winner, 'routingDecision.winner');
  const seen = new Set<string>([candidateKey(winner)]);
  const fallbacks = decision.fallbacks.map((candidate, index) => {
    const validated = validateCandidate(candidate, `routingDecision.fallbacks[${String(index)}]`);
    const key = candidateKey(validated);
    if (seen.has(key)) {
      throw new Error('Model routing decision contains a duplicate candidate identity.');
    }
    seen.add(key);
    return validated;
  });

  return {
    winner,
    fallbacks,
    whyThisModel: decision.whyThisModel,
  };
}

function selectionFromDecision(
  decision: EngineeringModelRoutingDecision,
): EngineeringModelSelection {
  return {
    provider: decision.winner.provider,
    model: decision.winner.model,
    whyThisModel: decision.whyThisModel,
    fallbackProviders: [...new Set(decision.fallbacks.map((candidate) => candidate.provider))],
  };
}

function decisionFromApprovedSelection(
  selection: EngineeringModelSelection,
): EngineeringModelRoutingDecision {
  return {
    winner: {
      provider: selection.provider,
      model: selection.model,
      revision: null,
    },
    fallbacks: [],
    whyThisModel: selection.whyThisModel,
  };
}

export class EngineeringRunner {
  readonly #dependencies: EngineeringRunnerDependencies;
  readonly #now: () => Date;

  constructor(dependencies: EngineeringRunnerDependencies) {
    this.#dependencies = dependencies;
    this.#now = dependencies.now ?? (() => new Date());
  }

  async run(envelope: EngineeringTaskEnvelope): Promise<EngineeringRunnerResult> {
    const machine = new EngineeringRunStateMachine(envelope);
    let workspace: EngineeringWorkspace | null = null;
    let correctionReason: string | null = null;
    let currentHeadSha: string | null = null;
    let activeModel: EngineeringModelCandidate | null = null;
    let stage = 'model routing';
    let evidenceSequence = 0;
    const unavailableModels = new Set<string>();

    const recordEvidence = async (
      state: EngineeringRunState,
      eventType: EngineeringEvidenceEventType,
      headSha: string | null,
      evidenceModel: EngineeringModelCandidate | null,
    ): Promise<void> => {
      const sequence = evidenceSequence + 1;
      await this.#dependencies.evidence.record({
        runId: state.runId,
        sequence,
        eventType,
        payload: {
          state,
          headSha,
          activeModel: evidenceModel === null ? null : { ...evidenceModel },
        },
        recordedAt: this.#now().toISOString(),
      });
      evidenceSequence = sequence;
    };

    try {
      const routingDecision =
        envelope.modelSelection === null
          ? validateRoutingDecision(await this.#dependencies.modelRouting.route(envelope))
          : validateRoutingDecision(decisionFromApprovedSelection(envelope.modelSelection));

      if (envelope.modelSelection === null) {
        machine.apply({
          type: 'MODEL_SELECTED',
          selection: selectionFromDecision(routingDecision),
        });
      }
      await recordEvidence(machine.state, 'model_selected', currentHeadSha, routingDecision.winner);

      stage = 'workspace preparation';
      await this.#authorize('create_feature_branch', envelope);
      workspace = requireWorkspace(await this.#dependencies.workspace.prepare(envelope), envelope);
      machine.apply({ type: 'START' });
      await recordEvidence(machine.state, 'workspace_prepared', currentHeadSha, null);

      const candidates = [routingDecision.winner, ...routingDecision.fallbacks];

      while (machine.state.status === 'executing') {
        stage = 'worker implementation';
        activeModel = null;

        for (const candidate of candidates) {
          if (unavailableModels.has(candidateKey(candidate))) {
            continue;
          }

          try {
            await this.#dependencies.worker.implement({
              envelope,
              workspace,
              attempt: machine.state.attempt,
              correctionReason,
              model: candidate,
            });
            activeModel = candidate;
            break;
          } catch (error) {
            if (!(error instanceof EngineeringProviderUnavailableError)) {
              throw error;
            }

            unavailableModels.add(candidateKey(candidate));
            await recordEvidence(machine.state, 'model_fallback', currentHeadSha, candidate);
          }
        }

        if (activeModel === null) {
          machine.apply({
            type: 'BLOCK',
            reason: 'No eligible engineering model remained available for worker execution.',
          });
          await recordEvidence(machine.state, 'blocked', currentHeadSha, null);
          break;
        }

        currentHeadSha = await this.#dependencies.workspace.readHead(workspace);
        requireSha(currentHeadSha, 'implementationHeadSha');
        machine.apply({ type: 'IMPLEMENTATION_READY' });
        await recordEvidence(
          machine.state,
          'implementation_completed',
          currentHeadSha,
          activeModel,
        );

        stage = 'validation';
        await this.#authorize('run_validation', envelope);
        const headBeforeValidation = await this.#dependencies.workspace.readHead(workspace);
        requireSha(headBeforeValidation, 'headBeforeValidation');
        const checks = await this.#dependencies.validation.validate(
          workspace,
          machine.state.requiredChecks,
        );
        const headAfterValidation = await this.#dependencies.workspace.readHead(workspace);
        requireSha(headAfterValidation, 'headAfterValidation');
        currentHeadSha = headAfterValidation;
        if (headAfterValidation !== headBeforeValidation) {
          machine.apply({
            type: 'BLOCK',
            reason: 'Engineering workspace HEAD changed during validation.',
          });
          await recordEvidence(machine.state, 'blocked', currentHeadSha, activeModel);
          break;
        }

        const validationFailure = validationFailureReason(machine.state.requiredChecks, checks);
        if (validationFailure !== null) {
          const state = machine.apply({ type: 'VALIDATION_FAILED', reason: validationFailure });
          correctionReason = validationFailure;
          await recordEvidence(state, 'validation_failed', currentHeadSha, activeModel);
          if (state.status === 'blocked') {
            break;
          }
          continue;
        }

        machine.apply({ type: 'VALIDATION_PASSED', checks });
        await recordEvidence(machine.state, 'validation_passed', currentHeadSha, activeModel);

        stage = 'independent review';
        const review = await this.#dependencies.review.review(workspace, headAfterValidation);
        if (!review.passed) {
          machine.apply({
            type: 'BLOCK',
            reason: 'Independent engineering review reported blocking findings.',
          });
          await recordEvidence(machine.state, 'blocked', currentHeadSha, activeModel);
          break;
        }
        const headAfterReview = await this.#dependencies.workspace.readHead(workspace);
        requireSha(headAfterReview, 'headAfterReview');
        currentHeadSha = headAfterReview;
        if (headAfterReview !== headAfterValidation) {
          machine.apply({
            type: 'BLOCK',
            reason: 'Engineering workspace HEAD changed during independent review.',
          });
          await recordEvidence(machine.state, 'blocked', currentHeadSha, activeModel);
          break;
        }
        machine.apply({ type: 'REVIEW_PASSED' });
        await recordEvidence(machine.state, 'review_passed', currentHeadSha, activeModel);

        stage = 'feature branch push';
        const headSha = headAfterReview;
        await this.#authorize('push_feature_branch', envelope);
        await this.#dependencies.workspace.pushFeatureBranch(workspace, headSha);
        await recordEvidence(machine.state, 'feature_branch_pushed', headSha, activeModel);

        stage = 'Draft PR publication';
        await this.#authorize('create_or_update_draft_pr', envelope);
        const pullRequest = await this.#dependencies.github.publishDraftPullRequest({
          branch: envelope.branch,
          baseBranch: 'main',
          headSha,
          title: `${envelope.taskId}: ${envelope.objective}`,
          body: `Autonomous engineering run ${envelope.runId}. Draft only; owner merge gate remains required.`,
        });

        if (pullRequest.headSha !== headSha) {
          machine.apply({
            type: 'BLOCK',
            reason: `Draft PR head ${pullRequest.headSha} does not match pushed head ${headSha}.`,
          });
          await recordEvidence(machine.state, 'blocked', headSha, activeModel);
          break;
        }

        machine.apply({
          type: 'DRAFT_PR_PUBLISHED',
          prNumber: pullRequest.number,
          headSha: pullRequest.headSha,
        });
        await recordEvidence(machine.state, 'draft_pr_published', headSha, activeModel);

        stage = 'GitHub CI observation';
        await this.#authorize('observe_ci', envelope);
        const ci = await this.#dependencies.github.waitForCi(pullRequest.number, headSha);
        requireSha(ci.headSha, 'ci.headSha');
        currentHeadSha = ci.headSha;

        if (ci.conclusion === 'success') {
          machine.apply({ type: 'CI_PASSED', headSha: ci.headSha });
          await recordEvidence(machine.state, 'ci_passed', ci.headSha, activeModel);
          break;
        }

        const ciFailureReason = `GitHub CI failed for exact head ${ci.headSha}.`;
        const state = machine.apply({
          type: 'CI_FAILED',
          headSha: ci.headSha,
          reason: ciFailureReason,
        });
        correctionReason = ciFailureReason;
        await recordEvidence(state, 'ci_failed', ci.headSha, activeModel);
        if (state.status === 'blocked') {
          break;
        }
      }
    } catch {
      if (
        machine.state.status !== 'blocked' &&
        machine.state.status !== 'ready_for_owner_decision'
      ) {
        machine.apply({
          type: 'BLOCK',
          reason: `Engineering runner failed closed during ${stage}.`,
        });
      }

      try {
        await recordEvidence(machine.state, 'blocked', currentHeadSha, activeModel);
      } catch {
        // Evidence persistence failure is itself fail-closed; do not mask the blocked run state.
      }
    }

    return {
      state: machine.state,
      workspace,
    };
  }

  async #authorize(
    action: AutonomousEngineeringAction,
    envelope: EngineeringTaskEnvelope,
  ): Promise<void> {
    assertAutonomousEngineeringActionAllowed(action);
    await this.#dependencies.authorization.assertAllowed({
      action,
      runId: envelope.runId,
      riskClass: envelope.riskClass,
      branch: envelope.branch,
    });
  }
}
