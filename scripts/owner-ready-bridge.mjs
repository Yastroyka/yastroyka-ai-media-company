import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const API_VERSION = '2022-11-28';
const REQUIRED_WORKFLOW_NAME = 'CI';
const REQUIRED_JOB_NAME = 'Quality';

export class OwnerReadyBridgeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'OwnerReadyBridgeError';
    this.code = code;
  }
}

function fail(code) {
  throw new OwnerReadyBridgeError(code);
}

export function parseOwnerReadyCommand(body) {
  const match = /^\/owner-ready ([0-9a-f]{40})$/u.exec(body ?? '');
  if (match === null) {
    fail('INVALID_OWNER_READY_COMMAND');
  }
  return match[1].toLowerCase();
}

export function parseRepository(repository) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(repository ?? '');
  if (match === null) {
    fail('INVALID_REPOSITORY');
  }
  return { owner: match[1], name: match[2] };
}

export function validateOwnerEvent({ eventName, event, repositoryOwner, actor }) {
  if (eventName !== 'issue_comment' || event?.action !== 'created') {
    fail('INVALID_TRIGGER');
  }
  if (event?.issue?.pull_request === undefined || event?.issue?.pull_request === null) {
    fail('TARGET_IS_NOT_PULL_REQUEST');
  }
  if (!Number.isSafeInteger(event.issue.number) || event.issue.number <= 0) {
    fail('INVALID_PULL_REQUEST_NUMBER');
  }
  if (actor !== repositoryOwner || event?.comment?.user?.login !== actor) {
    fail('OWNER_IDENTITY_MISMATCH');
  }
  if (event?.comment?.author_association !== 'OWNER') {
    fail('COMMENTER_IS_NOT_REPOSITORY_OWNER');
  }

  return {
    prNumber: event.issue.number,
    expectedHeadSha: parseOwnerReadyCommand(event.comment.body),
  };
}

export function validatePullRequest(pr, { repository, prNumber, expectedHeadSha }) {
  if (pr?.number !== prNumber || pr?.state !== 'open') {
    fail('PULL_REQUEST_NOT_OPEN');
  }
  if (pr?.draft !== true) {
    fail('PULL_REQUEST_NOT_DRAFT');
  }
  if (pr?.base?.repo?.full_name !== repository || pr?.head?.repo?.full_name !== repository) {
    fail('PULL_REQUEST_REPOSITORY_MISMATCH');
  }
  if (pr?.base?.ref !== 'main') {
    fail('PULL_REQUEST_BASE_MISMATCH');
  }
  if (typeof pr?.head?.sha !== 'string' || pr.head.sha.toLowerCase() !== expectedHeadSha) {
    fail('PULL_REQUEST_HEAD_MISMATCH');
  }
  if (typeof pr?.node_id !== 'string' || pr.node_id.length === 0) {
    fail('PULL_REQUEST_NODE_ID_MISSING');
  }
  return pr.node_id;
}

export function selectSuccessfulCiRun(runsPayload, prNumber, expectedHeadSha) {
  const runs = Array.isArray(runsPayload?.workflow_runs) ? runsPayload.workflow_runs : [];
  const candidates = runs.filter((run) => {
    const pullRequests = Array.isArray(run?.pull_requests) ? run.pull_requests : [];
    return (
      run?.name === REQUIRED_WORKFLOW_NAME &&
      run?.event === 'pull_request' &&
      run?.status === 'completed' &&
      run?.conclusion === 'success' &&
      typeof run?.head_sha === 'string' &&
      run.head_sha.toLowerCase() === expectedHeadSha &&
      pullRequests.some((pullRequest) => pullRequest?.number === prNumber)
    );
  });

  if (candidates.length === 0) {
    fail('EXACT_HEAD_CI_NOT_SUCCESSFUL');
  }

  return candidates.sort((left, right) => Number(right.id) - Number(left.id))[0];
}

export function validateQualityJob(jobsPayload, expectedHeadSha) {
  const jobs = Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : [];
  const qualityJobs = jobs
    .filter((job) => job?.name === REQUIRED_JOB_NAME)
    .sort((left, right) => Number(right.id) - Number(left.id));

  const quality = qualityJobs[0];
  if (
    quality === undefined ||
    quality?.status !== 'completed' ||
    quality?.conclusion !== 'success' ||
    (typeof quality?.head_sha === 'string' && quality.head_sha.toLowerCase() !== expectedHeadSha)
  ) {
    fail('QUALITY_JOB_NOT_SUCCESSFUL');
  }

  return quality.id;
}

export function validateReviewThreads(graphqlPayload) {
  const threads = graphqlPayload?.data?.repository?.pullRequest?.reviewThreads;
  if (threads === undefined || threads === null) {
    fail('REVIEW_THREADS_UNAVAILABLE');
  }
  if (threads?.pageInfo?.hasNextPage === true) {
    fail('REVIEW_THREADS_PAGINATION_UNSUPPORTED');
  }
  const nodes = Array.isArray(threads?.nodes) ? threads.nodes : [];
  if (nodes.some((thread) => thread?.isResolved !== true)) {
    fail('UNRESOLVED_REVIEW_THREAD');
  }
}

function githubHeaders(token) {
  if (typeof token !== 'string' || token.length === 0) {
    fail('GITHUB_TOKEN_MISSING');
  }
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': API_VERSION,
  };
}

async function requestJson(fetchImpl, url, options, failureCode) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch {
    fail(failureCode);
  }
  if (!response?.ok) {
    fail(failureCode);
  }
  try {
    return await response.json();
  } catch {
    fail(failureCode);
  }
}

async function rest(fetchImpl, token, repository, path) {
  return requestJson(
    fetchImpl,
    `https://api.github.com/repos/${repository}${path}`,
    { headers: githubHeaders(token) },
    'GITHUB_REST_REQUEST_FAILED',
  );
}

async function graphql(fetchImpl, token, query, variables, failureCode) {
  const payload = await requestJson(
    fetchImpl,
    'https://api.github.com/graphql',
    {
      method: 'POST',
      headers: {
        ...githubHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    },
    failureCode,
  );
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    fail(failureCode);
  }
  return payload;
}

const REVIEW_THREADS_QUERY = `
  query OwnerReadyReviewThreads($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes { isResolved }
          pageInfo { hasNextPage }
        }
      }
    }
  }
`;

const MARK_READY_MUTATION = `
  mutation OwnerReadyTransition($pullRequestId: ID!) {
    markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
      pullRequest {
        id
        isDraft
        headRefOid
      }
    }
  }
`;

export async function executeOwnerReadyBridge(
  { eventName, event, repository, repositoryOwner, actor, token },
  { fetchImpl = fetch } = {},
) {
  const { owner, name } = parseRepository(repository);
  const { prNumber, expectedHeadSha } = validateOwnerEvent({
    eventName,
    event,
    repositoryOwner,
    actor,
  });

  const pullRequest = await rest(fetchImpl, token, repository, `/pulls/${prNumber}`);
  const pullRequestNodeId = validatePullRequest(pullRequest, {
    repository,
    prNumber,
    expectedHeadSha,
  });

  const runsPayload = await rest(
    fetchImpl,
    token,
    repository,
    `/actions/runs?head_sha=${expectedHeadSha}&event=pull_request&per_page=100`,
  );
  const ciRun = selectSuccessfulCiRun(runsPayload, prNumber, expectedHeadSha);
  const jobsPayload = await rest(
    fetchImpl,
    token,
    repository,
    `/actions/runs/${ciRun.id}/jobs?per_page=100`,
  );
  const qualityJobId = validateQualityJob(jobsPayload, expectedHeadSha);

  const reviewThreadsPayload = await graphql(
    fetchImpl,
    token,
    REVIEW_THREADS_QUERY,
    { owner, name, number: prNumber },
    'REVIEW_THREADS_QUERY_FAILED',
  );
  validateReviewThreads(reviewThreadsPayload);

  const preTransitionPullRequest = await rest(fetchImpl, token, repository, `/pulls/${prNumber}`);
  validatePullRequest(preTransitionPullRequest, { repository, prNumber, expectedHeadSha });

  const transitionPayload = await graphql(
    fetchImpl,
    token,
    MARK_READY_MUTATION,
    { pullRequestId: pullRequestNodeId },
    'READY_TRANSITION_FAILED',
  );
  const transitioned = transitionPayload?.data?.markPullRequestReadyForReview?.pullRequest;
  if (
    transitioned?.isDraft !== false ||
    typeof transitioned?.headRefOid !== 'string' ||
    transitioned.headRefOid.toLowerCase() !== expectedHeadSha
  ) {
    fail('READY_TRANSITION_POSTCONDITION_FAILED');
  }

  const finalPullRequest = await rest(fetchImpl, token, repository, `/pulls/${prNumber}`);
  if (
    finalPullRequest?.draft !== false ||
    typeof finalPullRequest?.head?.sha !== 'string' ||
    finalPullRequest.head.sha.toLowerCase() !== expectedHeadSha
  ) {
    fail('READY_TRANSITION_FINAL_STATE_MISMATCH');
  }

  return {
    status: 'READY',
    repository,
    prNumber,
    headSha: expectedHeadSha,
    ciRunId: ciRun.id,
    qualityJobId,
  };
}

async function appendAudit(summary) {
  const auditPath = process.env.GITHUB_STEP_SUMMARY;
  if (typeof auditPath !== 'string' || auditPath.length === 0) {
    return;
  }
  const text = [
    '# Owner Ready Bridge',
    '',
    `- Result: **${summary.status}**`,
    `- Repository: \`${summary.repository}\``,
    `- PR: \`#${summary.prNumber}\``,
    `- Exact head: \`${summary.headSha}\``,
    `- CI run: \`${summary.ciRunId}\``,
    `- Quality job: \`${summary.qualityJobId}\``,
    '',
  ].join('\n');
  await appendFile(auditPath, text, 'utf8');
}

async function main() {
  try {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (typeof eventPath !== 'string' || eventPath.length === 0) {
      fail('GITHUB_EVENT_PATH_MISSING');
    }
    const event = JSON.parse(await readFile(eventPath, 'utf8'));
    const summary = await executeOwnerReadyBridge({
      eventName: process.env.GITHUB_EVENT_NAME,
      event,
      repository: process.env.GITHUB_REPOSITORY,
      repositoryOwner: process.env.GITHUB_REPOSITORY_OWNER,
      actor: process.env.GITHUB_ACTOR,
      token: process.env.GITHUB_TOKEN,
    });
    await appendAudit(summary);
    process.stdout.write(`OWNER_READY_BRIDGE_READY PR #${summary.prNumber} ${summary.headSha}\n`);
  } catch (error) {
    const code = error instanceof OwnerReadyBridgeError ? error.code : 'INTERNAL_ERROR';
    process.stderr.write(`OWNER_READY_BRIDGE_BLOCKED ${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
