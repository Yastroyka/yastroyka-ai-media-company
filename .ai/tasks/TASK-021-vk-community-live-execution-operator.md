# TASK-021 — VK Community controlled live execution operator

## Objective

Add the final operator-facing production bootstrap that can invoke the accepted TASK-020 guarded runtime only after an explicit destination-bound live confirmation.

## Depends on

- TASK-014 owner grant and production preflight;
- TASK-017 canonical approval packet operator;
- TASK-018 offline owner signer;
- TASK-019 signed execution verifier;
- TASK-020 production runtime composition.

## Scope

- add `vk:execute-live` under `@yastroyka/publishing`;
- require exact publication UUID, grant path, non-secret manifest path, and `--confirm-live-wall-post=<owner-id>`;
- parse and preflight the non-secret manifest before grant or database access;
- require the explicit confirmation owner ID to equal the preflight owner ID;
- parse the public owner-grant envelope before opening PostgreSQL;
- load the canonical AuthZ policy from `specs/authz/policy-contract.yaml`;
- reuse `EnvironmentSecretProvider` with fixed environment-variable bindings;
- reuse `VkCommunityHttpTransport` and TASK-020 `VkCommunityProductionRuntime`;
- close PostgreSQL on all runtime paths;
- emit only sanitized `PUBLISHED`, `BLOCKED`, or `UNKNOWN` operator evidence;
- treat transport/evidence/persistence failures as `UNKNOWN` because the external post may already exist.

## Fixed environment bindings

- `YASTROYKA_VK_COMMUNITY_ACCESS_TOKEN` supplies the manifest's `publishing/vk-community/...` reference;
- `YASTROYKA_VK_COMMUNITY_PUBLISHING_IDENTITY_SECRET` supplies the manifest's `publishing/identity/vk-community/...` reference.

Secret values are never accepted in command arguments, manifest files, logs, stdout, stderr, tests, or repository content.

## Safety invariants

- no owner private key in the runtime or CLI;
- no secret values in the non-secret manifest;
- no database, secret-provider, or network access for usage errors;
- no grant read, database, secret-provider, or network access for blocked preflight or destination-confirmation mismatch;
- cryptographic owner-grant verification remains inside the canonical runtime before secret access;
- canonical publication freshness is reread before VK credential access;
- no automatic retry after an `UNKNOWN` execution result;
- CI must never call the real VK network transport;
- this task does not activate production by itself.

## Exit codes

- `0` — exact canonical `PUBLISHED` result confirmed and persisted;
- `2` — safely `BLOCKED` before any potentially ambiguous external result;
- `64` — usage error;
- `65` — invalid local/operator input;
- `70` — operational failure or execution outcome `UNKNOWN`.

## Owner gate

The command may exist in code, but an actual production invocation is prohibited until the owner has reviewed the exact canonical preview and exact destination and then issued a separate explicit real-publish command.
