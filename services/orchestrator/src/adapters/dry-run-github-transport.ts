import type {
  GitHubCiTransportResult,
  GitHubDraftPullRequestTransportResult,
  GitHubEngineeringTransport,
} from './github-engineering-adapter.ts';
import type { EngineeringDraftPullRequestInput } from '../engineering-runner.ts';

export interface DryRunGitHubTransportOptions {
  readonly pullRequestNumber: number;
  readonly ciConclusion?: 'success' | 'failure';
}

export class DryRunGitHubEngineeringTransport implements GitHubEngineeringTransport {
  readonly #pullRequestNumber: number;
  readonly #ciConclusion: 'success' | 'failure';
  #lastPublished: EngineeringDraftPullRequestInput | null = null;

  constructor(options: DryRunGitHubTransportOptions) {
    if (!Number.isInteger(options.pullRequestNumber) || options.pullRequestNumber < 1) {
      throw new Error('pullRequestNumber must be a positive integer.');
    }
    this.#pullRequestNumber = options.pullRequestNumber;
    this.#ciConclusion = options.ciConclusion ?? 'success';
  }

  async upsertDraftPullRequest(
    input: EngineeringDraftPullRequestInput,
  ): Promise<GitHubDraftPullRequestTransportResult> {
    this.#lastPublished = { ...input };
    return {
      number: this.#pullRequestNumber,
      headSha: input.headSha,
      headBranch: input.branch,
      baseBranch: input.baseBranch,
      draft: true,
    };
  }

  async waitForPullRequestCi(
    prNumber: number,
    headSha: string,
  ): Promise<GitHubCiTransportResult> {
    if (
      this.#lastPublished === null ||
      prNumber !== this.#pullRequestNumber ||
      headSha !== this.#lastPublished.headSha
    ) {
      throw new Error('Dry-run CI observation does not match the published Draft PR head.');
    }

    return {
      prNumber,
      headSha,
      status: 'completed',
      conclusion: this.#ciConclusion,
      reason: this.#ciConclusion === 'failure' ? 'Dry-run CI failure.' : null,
    };
  }
}
