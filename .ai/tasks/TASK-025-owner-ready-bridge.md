# TASK-025 — GitHub Owner Ready Transition Bridge

## Objective

Provide a fail-closed, auditable owner transition path for Draft PR -> Ready for review without relying on the connector GraphQL response shape that currently fails on `fullDatabaseId`.

## Owner command

The canonical repository-side trigger is an exact PR conversation comment:

`/owner-ready <40-character exact-head SHA>`

The command is accepted only when the GitHub event actor and comment author are the repository owner and GitHub reports `author_association=OWNER`.

## Trusted execution boundary

- the workflow is an `issue_comment` workflow loaded from the protected default branch;
- it checks out trusted `main`, never the target PR head;
- untrusted PR code is never executed by the Ready bridge;
- workflow permissions are limited to `contents: read`, `actions: read`, and `pull-requests: write`;
- no repository or Actions secret is read; only the ephemeral workflow `github.token` is used for GitHub API authorization.

## Required validation before transition

The bridge must fail closed unless all of the following are true:

1. the target is an open Draft pull request;
2. base repository and head repository are the canonical repository;
3. base branch is `main`;
4. the current PR head equals the exact SHA embedded in the owner command;
5. a completed successful pull-request-triggered `CI` workflow run exists for that exact PR and exact head;
6. that workflow run contains a completed successful `Quality` job;
7. all review threads are resolved and review-thread pagination is fully inspected within the bounded query;
8. the PR is re-read immediately before mutation and still satisfies the exact-head Draft contract.

## Transition

The bridge uses a minimal owned GraphQL mutation containing only `markPullRequestReadyForReview` and the fields required to verify the result. It deliberately does not request `fullDatabaseId` or any unrelated repository metadata.

After mutation it verifies:

- `isDraft=false`;
- returned `headRefOid` still equals the owner-approved exact head;
- a final REST read confirms the PR remains on that exact head and is Ready.

If any postcondition fails, the run reports BLOCKED/FAIL and never claims a successful owner transition.

## Safety boundary

Allowed:

- read PR metadata;
- read exact-head GitHub Actions evidence;
- read review-thread resolution state;
- perform the single Draft -> Ready transition;
- emit sanitized workflow evidence.

Forbidden:

- merge or squash merge;
- enable auto-merge;
- push code or move refs;
- modify repository files;
- change branch protection or repository settings;
- read repository/Actions secrets;
- provision credentials;
- deploy or publish externally;
- invoke VK runtime or `wall.post`.

## Tests / acceptance

Required automated coverage proves:

- command injection or malformed SHA is rejected;
- non-owner triggers are rejected;
- non-Draft, wrong-repository, wrong-base, or moved-head PRs are rejected;
- stale/failed CI or failed `Quality` blocks;
- unresolved review threads block;
- the GraphQL mutation uses `markPullRequestReadyForReview` without `fullDatabaseId`;
- post-transition head movement cannot be reported as success;
- returned/audited evidence contains no token material.

The bridge tests are part of the canonical repository `Quality` gate.

## Audit evidence

The owner command comment is the durable owner-decision record. The workflow run and GitHub step summary record repository, PR number, exact head SHA, CI run ID, Quality job ID, and final READY/BLOCKED outcome without secret values.

## Bootstrap rule

GitHub loads `issue_comment` workflows from the default branch. Therefore TASK-025 cannot use its own bridge to transition PR #35 before TASK-025 itself is merged. PR #35 requires the existing owner Ready gate once; after merge, subsequent PRs use the repository-side bridge.

## Rollback

Revert the TASK-025 squash commit. No database migration, production state, credential, VK state, or external-system rollback is required.
