import {
  EngineeringRunStateMachine,
  assertAutonomousEngineeringActionAllowed,
  type AutonomousEngineeringAction,
  type EngineeringCheckEvidence,
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

export interface EngineeringWorkerInput {
  readonly envelope: EngineeringTaskEnvelope;
  readonly workspace: EngineeringWorkspace;
  readonly attempt: number;
  readonly correctionReason: string | null;
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

export interface EngineeringRunnerDependencies {
  readonly authorization: EngineeringAuthorizationPort;
  readonly workspace: EngineeringWorkspacePort;
  readonly worker: EngineeringWorkerPort;
  readonly validation: EngineeringValidationPort;
  readonly review: EngineeringReviewPort;
  readonly github: EngineeringGitHubPort;
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

export class EngineeringRunner {
  readonly #dependencies: EngineeringRunnerDependencies;

  constructor(dependencies: EngineeringRunnerDependencies) {
    this.#dependencies = dependencies;
  }

  async run(envelope: EngineeringTaskEnvelope): Promise<EngineeringRunnerResult> {
    const machine = new EngineeringRunStateMachine(envelope);
    let workspace: EngineeringWorkspace | null = null;
    let correctionReason: string | null = null;
    let stage = 'workspace preparation';

    try {
      await this.#authorize('create_feature_branch', envelope);
      workspace = requireWorkspace(await this.#dependencies.workspace.prepare(envelope), envelope);
      machine.apply({ type: 'START' });

      while (machine.state.status === 'executing') {
        stage = 'worker implementation';
        await this.#dependencies.worker.implement({
          envelope,
          workspace,
          attempt: machine.state.attempt,
          correctionReason,
        });
        machine.apply({ type: 'IMPLEMENTATION_READY' });

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
        if (headAfterValidation !== headBeforeValidation) {
          machine.apply({
            type: 'BLOCK',
            reason: 'Engineering workspace HEAD changed during validation.',
          });
          break;
        }

        const validationFailure = validationFailureReason(machine.state.requiredChecks, checks);
        if (validationFailure !== null) {
          const state = machine.apply({ type: 'VALIDATION_FAILED', reason: validationFailure });
          correctionReason = validationFailure;
          if (state.status === 'blocked') {
            break;
          }
          continue;
        }

        machine.apply({ type: 'VALIDATION_PASSED', checks });

        stage = 'independent review';
        const review = await this.#dependencies.review.review(workspace, headAfterValidation);
        if (!review.passed) {
          machine.apply({
            type: 'BLOCK',
            reason: 'Independent engineering review reported blocking findings.',
          });
          break;
        }
        const headAfterReview = await this.#dependencies.workspace.readHead(workspace);
        requireSha(headAfterReview, 'headAfterReview');
        if (headAfterReview !== headAfterValidation) {
          machine.apply({
            type: 'BLOCK',
            reason: 'Engineering workspace HEAD changed during independent review.',
          });
          break;
        }
        machine.apply({ type: 'REVIEW_PASSED' });

        stage = 'feature branch push';
        const headSha = headAfterReview;
        await this.#authorize('push_feature_branch', envelope);
        await this.#dependencies.workspace.pushFeatureBranch(workspace, headSha);

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
          break;
        }

        machine.apply({
          type: 'DRAFT_PR_PUBLISHED',
          prNumber: pullRequest.number,
          headSha: pullRequest.headSha,
        });

        stage = 'GitHub CI observation';
        await this.#authorize('observe_ci', envelope);
        const ci = await this.#dependencies.github.waitForCi(pullRequest.number, headSha);
        requireSha(ci.headSha, 'ci.headSha');

        if (ci.conclusion === 'success') {
          machine.apply({ type: 'CI_PASSED', headSha: ci.headSha });
          break;
        }

        const ciFailureReason = `GitHub CI failed for exact head ${ci.headSha}.`;
        const state = machine.apply({
          type: 'CI_FAILED',
          headSha: ci.headSha,
          reason: ciFailureReason,
        });
        correctionReason = ciFailureReason;
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
