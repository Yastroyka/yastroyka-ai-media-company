# TASK-020 — VK Community Production Runtime Composition

## OBJECTIVE
Compose the accepted VK Community production components into one runtime boundary without adding an operator command that can accidentally invoke the live VK transport.

## CONTEXT
TASK-014 established owner grants and production preflight. TASK-015 added safe operator preflight. TASK-016/017 established the exact canonical approval packet from PostgreSQL. TASK-018 added offline owner signing. TASK-019 added a fresh signed-execution verifier. The remaining architecture gap is a single composition root that wires the canonical runtime controller, HMAC identity verifier, VK publishing adapter, live result publisher, PostgreSQL publication/result stores, authorization audit and caller-supplied Secret Provider/transport.

## SCOPE
- add a `VkCommunityProductionRuntime` composition root in `services/publishing`;
- require canonical production preflight READY at construction;
- bind one exact community ID and owner public key for the runtime lifetime;
- use `PostgresPlatformWorkspaceStore` for canonical publication reads;
- use `PostgresVkCommunityResultStore` for authorized result persistence;
- use `HmacPublishingIdentityBinding` for the short-lived runtime identity;
- use `VkCommunityPublishingAdapter` for fresh canonical re-read, VK credential access and transport execution;
- use `VkCommunityLivePublisher` for external evidence validation and canonical `PUBLISHED` persistence;
- use `VkCommunityRuntimeController` as the only execution entry point;
- accept Secret Provider and VK transport as explicit dependencies rather than constructing them implicitly;
- add a real PostgreSQL integration test with fake VK transport and in-memory secrets;
- prove the complete chain ends in canonical `PUBLISHED` with exact VK evidence;
- prove tampered owner grants never reach transport or VK credential access.

## OUT OF SCOPE
- no production VK Community ID;
- no real VK credential;
- no real publishing-identity HMAC value;
- no owner private key in runtime;
- no new secret storage mechanism;
- no production CLI that invokes `wall.post`;
- no automatic production activation;
- no network call in CI.

## RISK
R3. Production-capable composition code, but no implicit live transport and no operator command that invokes it.

## ACCEPTANCE
- construction fails closed when production preflight is BLOCKED;
- the same canonical publication state feeds preview, grant binding and pre-token re-read;
- identity HMAC secret is consumed only after exact owner grant verification;
- VK credential is consumed only after the fresh preview fingerprint matches the trusted runtime identity;
- fake transport receives the exact owner ID/message/idempotency key and token only on the valid path;
- successful fake transport evidence is persisted as exact canonical `PUBLISHED` state;
- tampered owner grant causes no VK transport call and no secret access;
- no secret values appear in persisted payload/evidence or returned errors;
- exact-head CI passes.

## ROLLBACK
Close the Draft PR or revert its squash commit. No schema migration is introduced.

## OWNER GATE
This task builds capability only. A real VK publication still requires a separate exact owner command after the exact preview and destination have been shown.
