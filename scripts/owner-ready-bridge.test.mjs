import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OwnerReadyBridgeError,
  executeOwnerReadyBridge,
  parseOwnerReadyCommand,
  selectSuccessfulCiRun,
  validateOwnerEvent,
  validatePullRequest,
  validateQualityJob,
  validateReviewThreads,
} from './owner-ready-bridge.mjs';

const REPOSITORY = 'Yastroyka/yastroyka-ai-media-company';
const OWNER = 'Yastroyka';
const SHA = '1111111111111111111111111111111111111111';
const PR_NUMBER = 35;
const PR_NODE_ID = 'PR_node_35';

function ownerEvent(body = `/owner-ready ${SHA}`) {
  return {
    action: 'created',
    issue: {
      number: PR_NUMBER,
      pull_request: { url: 'https://api.github.com/example' },
    },
    comment: {
      body,
      author_association: 'OWNER',
      user: { login: OWNER },
    },
  };
}

function draftPullRequest(overrides = {}) {
  return {
    number: PR_NUMBER,
    state: 'open',
    draft: true,
    node_id: PR_NODE_ID,
    base: {
      ref: 'main',
      repo: { full_name: REPOSITORY },
    },
    head: {
      sha: SHA,
      repo: { full_name: REPOSITORY },
    },
    ...overrides,
  };
}

function response(payload, ok = true) {
  return {
    ok,
    async json() {
      return payload;
    },
  };
}

function bridgeFetch({ unresolved = false, movedHead = false } = {}) {
  const calls = [];
  let pullReadCount = 0;

  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.endsWith(`/pulls/${PR_NUMBER}`)) {
      pullReadCount += 1;
      if (pullReadCount === 3) {
        return response({
          ...draftPullRequest(),
          draft: false,
          head: {
            ...draftPullRequest().head,
            sha: movedHead ? '2222222222222222222222222222222222222222' : SHA,
          },
        });
      }
      return response(draftPullRequest());
    }

    if (url.includes('/actions/runs?')) {
      return response({
        workflow_runs: [
          {
            id: 559,
            name: 'CI',
            event: 'pull_request',
            status: 'completed',
            conclusion: 'success',
            head_sha: SHA,
            pull_requests: [{ number: PR_NUMBER }],
          },
        ],
      });
    }

    if (url.endsWith('/actions/runs/559/jobs?per_page=100')) {
      return response({
        jobs: [
          {
            id: 1001,
            name: 'Quality',
            status: 'completed',
            conclusion: 'success',
            head_sha: SHA,
          },
        ],
      });
    }

    if (url === 'https://api.github.com/graphql') {
      const body = JSON.parse(options.body);
      if (body.query.includes('reviewThreads')) {
        return response({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: unresolved ? [{ isResolved: false }] : [{ isResolved: true }],
                  pageInfo: { hasNextPage: false },
                },
              },
            },
          },
        });
      }
      if (body.query.includes('markPullRequestReadyForReview')) {
        return response({
          data: {
            markPullRequestReadyForReview: {
              pullRequest: {
                id: PR_NODE_ID,
                isDraft: false,
                headRefOid: SHA,
              },
            },
          },
        });
      }
    }

    throw new Error(`unexpected test request: ${url}`);
  };

  return { calls, fetchImpl };
}

function expectBridgeCode(fn, code) {
  assert.throws(fn, (error) => error instanceof OwnerReadyBridgeError && error.code === code);
}

test('owner command is exact and rejects command injection', () => {
  assert.equal(parseOwnerReadyCommand(`/owner-ready ${SHA}`), SHA);
  expectBridgeCode(() => parseOwnerReadyCommand(`/owner-ready ${SHA}; echo unsafe`), 'INVALID_OWNER_READY_COMMAND');
  expectBridgeCode(() => parseOwnerReadyCommand(`/owner-ready ${SHA} `), 'INVALID_OWNER_READY_COMMAND');
});

test('trigger accepts only a created PR comment from the repository owner', () => {
  assert.deepEqual(
    validateOwnerEvent({
      eventName: 'issue_comment',
      event: ownerEvent(),
      repositoryOwner: OWNER,
      actor: OWNER,
    }),
    { prNumber: PR_NUMBER, expectedHeadSha: SHA },
  );

  expectBridgeCode(
    () =>
      validateOwnerEvent({
        eventName: 'issue_comment',
        event: { ...ownerEvent(), comment: { ...ownerEvent().comment, author_association: 'MEMBER' } },
        repositoryOwner: OWNER,
        actor: OWNER,
      }),
    'COMMENTER_IS_NOT_REPOSITORY_OWNER',
  );
});

test('pull request validation is exact-head, same-repository, main-only and Draft-only', () => {
  assert.equal(
    validatePullRequest(draftPullRequest(), {
      repository: REPOSITORY,
      prNumber: PR_NUMBER,
      expectedHeadSha: SHA,
    }),
    PR_NODE_ID,
  );

  expectBridgeCode(
    () =>
      validatePullRequest(draftPullRequest({ draft: false }), {
        repository: REPOSITORY,
        prNumber: PR_NUMBER,
        expectedHeadSha: SHA,
      }),
    'PULL_REQUEST_NOT_DRAFT',
  );
  expectBridgeCode(
    () =>
      validatePullRequest(
        draftPullRequest({ head: { sha: '2222222222222222222222222222222222222222', repo: { full_name: REPOSITORY } } }),
        { repository: REPOSITORY, prNumber: PR_NUMBER, expectedHeadSha: SHA },
      ),
    'PULL_REQUEST_HEAD_MISMATCH',
  );
});

test('CI validation requires exact PR/head successful CI and successful Quality job', () => {
  const run = selectSuccessfulCiRun(
    {
      workflow_runs: [
        {
          id: 559,
          name: 'CI',
          event: 'pull_request',
          status: 'completed',
          conclusion: 'success',
          head_sha: SHA,
          pull_requests: [{ number: PR_NUMBER }],
        },
      ],
    },
    PR_NUMBER,
    SHA,
  );
  assert.equal(run.id, 559);

  assert.equal(
    validateQualityJob(
      {
        jobs: [
          {
            id: 1001,
            name: 'Quality',
            status: 'completed',
            conclusion: 'success',
            head_sha: SHA,
          },
        ],
      },
      SHA,
    ),
    1001,
  );

  expectBridgeCode(
    () =>
      selectSuccessfulCiRun(
        {
          workflow_runs: [
            {
              id: 559,
              name: 'CI',
              event: 'pull_request',
              status: 'completed',
              conclusion: 'failure',
              head_sha: SHA,
              pull_requests: [{ number: PR_NUMBER }],
            },
          ],
        },
        PR_NUMBER,
        SHA,
      ),
    'EXACT_HEAD_CI_NOT_SUCCESSFUL',
  );
});

test('unresolved review threads block Ready transition', () => {
  expectBridgeCode(
    () =>
      validateReviewThreads({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [{ isResolved: false }],
                pageInfo: { hasNextPage: false },
              },
            },
          },
        },
      }),
    'UNRESOLVED_REVIEW_THREAD',
  );
});

test('end-to-end bridge uses minimal GraphQL Ready mutation and emits safe evidence', async () => {
  const { calls, fetchImpl } = bridgeFetch();
  const result = await executeOwnerReadyBridge(
    {
      eventName: 'issue_comment',
      event: ownerEvent(),
      repository: REPOSITORY,
      repositoryOwner: OWNER,
      actor: OWNER,
      token: 'test-token-never-logged',
    },
    { fetchImpl },
  );

  assert.deepEqual(result, {
    status: 'READY',
    repository: REPOSITORY,
    prNumber: PR_NUMBER,
    headSha: SHA,
    ciRunId: 559,
    qualityJobId: 1001,
  });

  const graphqlBodies = calls
    .filter((call) => call.url === 'https://api.github.com/graphql')
    .map((call) => JSON.parse(call.options.body));
  const mutation = graphqlBodies.find((body) => body.query.includes('markPullRequestReadyForReview'));
  assert.notEqual(mutation, undefined);
  assert.doesNotMatch(mutation.query, /fullDatabaseId/u);
  assert.deepEqual(mutation.variables, { pullRequestId: PR_NODE_ID });
  assert.doesNotMatch(JSON.stringify(result), /test-token-never-logged/u);
});

test('post-transition head movement fails closed instead of claiming success', async () => {
  const { fetchImpl } = bridgeFetch({ movedHead: true });
  await assert.rejects(
    executeOwnerReadyBridge(
      {
        eventName: 'issue_comment',
        event: ownerEvent(),
        repository: REPOSITORY,
        repositoryOwner: OWNER,
        actor: OWNER,
        token: 'test-token',
      },
      { fetchImpl },
    ),
    (error) =>
      error instanceof OwnerReadyBridgeError && error.code === 'READY_TRANSITION_FINAL_STATE_MISMATCH',
  );
});
