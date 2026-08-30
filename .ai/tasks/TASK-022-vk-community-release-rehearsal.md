# TASK-022 — VK Community Release Rehearsal

## OBJECTIVE
Add a final read-only operator rehearsal that shows the exact production destination and canonical preview before any owner grant is signed or any secret-bearing/live execution path is entered.

## CONTEXT
TASK-017 already produces the canonical approval packet. TASK-021 adds the guarded live execution operator. Before the first real VK publication, the owner needs one deterministic pre-publish view that combines production preflight metadata, the exact canonical approval packet, and the exact live destination confirmation while preserving the existing rule that secret material is not accessed before owner-grant verification.

## SCOPE
- add `vk:release-rehearsal <publication-id> <non-secret-manifest.json>` under `@yastroyka/publishing`;
- parse and validate the exact non-secret production manifest;
- run canonical production preflight before PostgreSQL access;
- require the environment-backed secret-provider mode used by TASK-021, but do not read environment secret values;
- open the existing read-only PostgreSQL publication-state lease;
- prepare the canonical TASK-017 approval packet for exact `VK_COMMUNITY + AUTO` state;
- output exact `communityId`, negative `ownerId`, canonical approval packet, and exact `--confirm-live-wall-post=<owner-id>` confirmation string;
- output only the names of the two required environment variables, never their values;
- explicitly report that the rehearsal performed no secret-material access and no network access;
- close the read-only database lease before output.

## OUT OF SCOPE
- no VK access token read;
- no publishing-identity secret read;
- no owner-grant read or signature verification;
- no owner private key;
- no network request;
- no VK identity lookup;
- no `wall.post`;
- no publication mutation;
- no production activation.

## RISK
R0/R1. Read-only production rehearsal. It may expose intended public publication text and public destination metadata to the operator, but it has no secret or network capability.

## ACCEPTANCE
- usage and invalid input touch neither PostgreSQL nor network/secrets;
- production preflight BLOCKED prevents PostgreSQL open;
- READY output contains the exact canonical approval packet and exact live confirmation string;
- canonical publication errors fail closed with sanitized codes;
- the PostgreSQL lease is always closed before READY/BLOCKED output;
- no code path reads either production environment secret value;
- no transport object is constructed;
- exact-head CI passes.

## OWNER GATE
This task only prepares a read-only rehearsal. A real VK publication remains prohibited until the exact community ID is independently confirmed, external secrets are provisioned, the owner reviews the exact rehearsal/approval packet, signs the grant, and then issues a separate explicit real-publish command.

## ROLLBACK
Close the Draft PR or revert its squash commit. No schema or deployment rollback is required.
