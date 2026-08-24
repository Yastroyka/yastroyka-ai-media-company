import { assertAutonomousEngineeringActionAllowed } from '../engineering-run.ts';
import type {
  EngineeringCiResult,
  EngineeringDraftPullRequest,
  EngineeringDraftPullRequestInput,
  EngineeringGitHubPort,
} from '../engineering-runner.ts';

export interface GitHubDraftPullRequestTransportResult {
  readonly number: number;
  readonly headSha: string;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly draft: boolean;
}

export interface GitHubCiTransportResult {
  readonly prNumber: number;
  readonly headSha: string;
  readonly status: 'queued' | 'in_progress' | 'completed';
  readonly conclusion: 'success' | 'failure' | null;
  readonly reason: string | null;
}

export interface GitHubEngineeringTransport {
  upsertDraftPullRequest(
    input: EngineeringDraftPullRequestInput,
  ): Promise<GitHubDraftPullRequestTransportResult>;
  waitForPullRequestCi(prNumber: number, headSha: string): Promise<GitHubCiTransportResult>;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

function requireSha(value: string, field: string): void {
  if (!SHA_PATTERN.test(value)) {
    throw new Error(`${field} must be an exact 40-character lowercase Git SHA.`);
  }
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
}

export class GitHubEngineeringAdapter implements EngineeringGitHubPort {
  readonly #transport: GitHubEngineeringTransport;

  constructor(transport: GitHubEngineeringTransport) {
    this.#transport = transport;
  }

  async publishDraftPullRequest(
    input: EngineeringDraftPullRequestInput,
  ): Promise<EngineeringDraftPullRequest> {
    assertAutonomousEngineeringActionAllowed('create_or_update_draft_pr');
    requireSha(input.headSha, 'input.headSha');
    if (input.branch === 'main' || input.branch === 'refs/heads/main') {
      throw new Error('Draft PR publication cannot use protected main as the head branch.');
    }

    const result = await this.#transport.upsertDraftPullRequest(input);
    requirePositiveInteger(result.number, 'pullRequest.number');
    requireSha(result.headSha, 'pullRequest.headSha');
    if (!result.draft) {
      throw new Error(
        'GitHub transport returned a non-Draft PR; autonomous publication fails closed.',
      );
    }
    if (result.headBranch !== input.branch || result.baseBranch !== input.baseBranch) {
      throw new Error('GitHub transport returned Draft PR evidence for unexpected branches.');
    }
    if (result.headSha !== input.headSha) {
      throw new Error('GitHub transport returned Draft PR evidence for a different head SHA.');
    }

    return {
      number: result.number,
      headSha: result.headSha,
      draft: true,
    };
  }

  async waitForCi(prNumber: number, expectedHeadSha: string): Promise<EngineeringCiResult> {
    assertAutonomousEngineeringActionAllowed('observe_ci');
    requirePositiveInteger(prNumber, 'prNumber');
    requireSha(expectedHeadSha, 'expectedHeadSha');

    const result = await this.#transport.waitForPullRequestCi(prNumber, expectedHeadSha);
    requirePositiveInteger(result.prNumber, 'ci.prNumber');
    requireSha(result.headSha, 'ci.headSha');
    if (result.prNumber !== prNumber) {
      throw new Error('GitHub CI transport returned evidence for a different pull request.');
    }
    if (result.headSha !== expectedHeadSha) {
      throw new Error('GitHub CI transport returned evidence for a different head SHA.');
    }
    if (result.status !== 'completed' || result.conclusion === null) {
      throw new Error('GitHub CI transport returned non-terminal evidence after waitForPullRequestCi.');
    }

    return {
      headSha: result.headSha,
      conclusion: result.conclusion,
      reason: result.reason,
    };
  }
}
