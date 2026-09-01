# TASK-012 — Golden Evals Release Gate

## OBJECTIVE

Turn the accepted R1 implementation and its acceptance suites into one executable, reviewable, fail-closed release gate with sanitized per-gate evidence.

## CONTEXT

Follow the Project Constitution, `AGENTS.md`, `ENGINEERING_RULES.md`, and `docs/agentic/AGENT_EXECUTION_CONTRACT.md`.

R1 already has subsystem acceptance suites for authorization, orchestration, Model Exchange, Temporal, commerce, Control Room, publishing/owner control, and canonical PostgreSQL state. CI historically invoked those checks as independent workflow steps. TASK-012 makes the release decision explicit and machine-readable without weakening any existing check.

## SCOPE

- add a repository-owned `R1` hard-gate manifest;
- map each hard gate to its governing Constitution/contract authority;
- execute only argument-vector `node` / `pnpm` commands with `shell: false`;
- run the existing R1 typecheck/test/build acceptance commands through the gate rather than duplicating a second test implementation;
- emit `PASS`, `FAIL`, or `NOT_RUN` command evidence for every hard gate;
- continue evaluating later independent hard gates after an earlier gate fails, while blocking dependent commands inside the failed gate;
- return a failing process exit code unless every hard gate is `PASS`;
- bind CI evidence to the exact pull-request head SHA (or exact push SHA);
- write sanitized local JSON evidence under ignored `.tmp/` state;
- append a sanitized hard-gate summary to GitHub Actions step summary when available;
- scope transient `YASTROYKA_DB_*` test environment only to the canonical PostgreSQL hard gate;
- keep the existing protected required check name `Quality` while making the R1 release gate its canonical acceptance entrypoint;
- add self-tests for manifest validation, fail-closed behavior, NOT_RUN evidence, revision binding, environment scoping, and secret/error sanitization.

## OUT OF SCOPE

- no production deployment or release action;
- no automatic merge, Ready transition, tag, GitHub Release, package publish, or production write;
- no credential issuance or secret provisioning;
- no new external action, package, provider, framework, language, database, or network dependency;
- no weakening or removal of an R1 acceptance suite;
- no acceptance of a release when a hard gate is `FAIL` or `NOT_RUN`;
- no raw stdout/stderr, environment values, credentials, tokens, passwords, private keys, or arbitrary executor errors in release evidence;
- no TASK-013+ scope.

## HARD GATES

The R1 manifest covers:

1. release-gate engine self-test;
2. repository quality/policy;
3. AuthZ and human-control boundaries;
4. owned Orchestrator governance;
5. Model Exchange routing authority;
6. Temporal durability;
7. Commerce read-only/data boundaries;
8. Control Room owned-backend contract/build;
9. Publishing and owner-signing control;
10. canonical PostgreSQL state and full DB integration, including TASK-011 attribution.

## SECURITY / EVIDENCE BOUNDARY

- command execution uses `shell: false` and a strict executable allowlist (`node`, `pnpm`);
- the manifest cannot define environment variables;
- transient `YASTROYKA_DB_HOST`, `YASTROYKA_DB_PORT`, `YASTROYKA_DB_NAME`, `YASTROYKA_DB_USER`, and `YASTROYKA_DB_PASSWORD` values are removed from every child environment except `POSTGRES_CANONICAL_STATE`;
- evidence contains only release/revision/time, gate/command IDs and labels, authority references, status, exit code, sanitized error code, and duration;
- child-process stdout/stderr may remain normal CI logs, but is never copied into the JSON evidence object;
- thrown executor errors collapse to a fixed `EXECUTOR_ERROR` code;
- CI supplies PostgreSQL test credentials through the release-gate process environment, but the runner scopes them to the PostgreSQL gate and never serializes them.

## RISK

R2 for implementation because TASK-012 changes the canonical CI/release-governance entrypoint. The change is reversible and performs no production, credential, dependency-trust, or external write. Ready and merge remain independent human gates.

## ACCEPTANCE

- every declared R1 hard gate emits reviewable evidence;
- all hard gates `PASS` produces overall `PASS` and exit code 0;
- any failed command makes its hard gate `FAIL` and the overall release gate fail;
- commands later in the same failed gate emit `NOT_RUN` rather than silently disappearing;
- later independent gates still emit evidence;
- malformed/duplicate/unsafe manifests fail closed;
- arbitrary executor error text or extra result fields cannot enter evidence;
- CI binds the evidence to the exact source SHA;
- PostgreSQL test environment is unavailable to non-PostgreSQL hard gates;
- the existing R1 acceptance commands remain covered by the canonical `Quality` job;
- no release/deployment/merge side effect is introduced.

## TESTS

- `node --test scripts/r1-release-gate.test.mjs`;
- `pnpm run quality:check` through the release gate;
- every existing R1 subsystem typecheck/test/build command through the release gate;
- environment-scope self-test proving `YASTROYKA_DB_*` is visible only to `POSTGRES_CANONICAL_STATE`;
- full PostgreSQL integration suite through the release gate;
- exact-head GitHub Actions `Quality` result.

## ROLLBACK

Revert the TASK-012 squash commit. This restores the previous explicit CI step layout; no database migration, production state, credential, or external system rollback is required.

## EVIDENCE

Provide exact base/head SHA, changed-file scope, manifest gate list, self-test results, exact-head CI, sanitized step-summary behavior, environment-scope evidence, security review, rollback statement, and open risks.

## OWNER GATES

Draft PR may be created autonomously. Ready transition and merge are separate explicit owner actions. TASK-012 does not authorize an actual production release.

## CONFLICT RULE

Return `BLOCKED/CONFLICT` instead of guessing or weakening a hard gate.
