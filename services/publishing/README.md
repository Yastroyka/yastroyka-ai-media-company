# Publishing Service

This directory owns the promotion boundary from an approved canonical publication to an external platform write.

## VK Community promotion sequence

The first real VK Community post must not be enabled until all of the following are wired and independently verified:

1. PostgreSQL publication state is loaded by `publicationId` and is exactly `VK_COMMUNITY` + `AUTO`.
2. A read-only approval packet is generated from the canonical publication. It contains the exact VK preview and a deterministic fingerprint of publication ID, platform, destination, message, and idempotency key.
3. A short-lived Ed25519 owner execution grant is verified for that exact publication, deployment-owned VK Community destination, and exact preview fingerprint. The publishing runtime has only the owner public verification key.
4. Only after that owner grant is verified may the runtime issue the narrow short-lived `publishing_service` identity for the `vk-community-publish` audience, carrying the same preview fingerprint.
5. The guarded publishing adapter recomputes the canonical preview and rejects a preview-fingerprint mismatch before VK credential access or external transport.
6. The VK credential is referenced only through the Secret Provider boundary under `publishing/vk-community/*`.
7. The owner private Ed25519 signing key stays outside the publishing runtime entirely. The publishing runtime receives only the public verification key; publishing-identity HMAC material remains behind the Secret Provider boundary.
8. Secret material is transient: it is never persisted, logged, returned, copied into evidence, or attached to an error.
9. The concrete VK HTTP transport is pinned to `https://api.vk.com/method/wall.post` and VK API `5.199`.
10. The destination community is deployment-owned configuration, not a per-request caller-selected destination.
11. The transport result is validated before it can be recorded as canonical publication evidence.
12. Successful external publication is followed by canonical result persistence; retry uses the same deterministic idempotency key so an ambiguous network/result-persistence failure does not intentionally create a second post.
13. Production credential activation and the first real external write require an explicit owner gate.

## Current implementation

The repository now contains:

- `VkCommunityPreviewReader` as the single canonical read-only `VK_COMMUNITY + AUTO` preview implementation used by both approval and execution;
- `VkCommunityApprovalPacketReader` for the exact owner-inspectable preview plus deterministic preview fingerprint, with no Secret Provider or transport dependency;
- `VkCommunityPublishingAdapter` for transient Secret Provider access and guarded external execution while recomputing preview through the same canonical reader;
- `HmacPublishingIdentityBinding` for short-lived `publishing_service` identity verification bound to exact publication and destination;
- `VkCommunityHttpTransport` pinned to `https://api.vk.com/method/wall.post` and VK API `5.199`;
- `VkCommunityLivePublisher` for external execution followed by exact canonical result persistence;
- `PostgresVkCommunityResultStore` for idempotent `AUTO -> PUBLISHED` result persistence;
- `VkCommunityRuntimeController` for read-only preview/approval packets plus verification of a separate short-lived owner execution grant bound to the exact preview fingerprint before service identity issuance;
- `vk-community-owner-grant` as the single canonical owner-grant assertion/signing/verifying contract shared by the offline signer and runtime verifier;
- `preflightVkCommunityProductionActivation` for side-effect-free validation of production destination/public-key/secret-reference metadata before any secret value is read.

The runtime controller intentionally contains only the owner's Ed25519 public verification key and therefore cannot cryptographically mint an owner grant. The private signing key must remain in a trusted owner-side signing operation outside the ordinary publishing runtime.

## Canonical approval packet

`VkCommunityApprovalPacketReader` accepts only deployment-owned `communityId` metadata and a read-only `VkCommunityPublicationStatePort`. The existing PostgreSQL platform workspace store already exposes a compatible `findById(publicationId)` read contract, so composition can inject canonical PostgreSQL state without making the orchestrator depend on the database package.

The reader accepts only an exact `VK_COMMUNITY` publication in `AUTO` state. It emits exactly:

- the canonical preview: publication ID, platform, negative VK owner ID derived from deployment community ID, `fromGroup=true`, exact message, and deterministic idempotency key;
- the deterministic preview fingerprint over those exact fields.

The publishing adapter uses that same `VkCommunityPreviewReader` again immediately before credential access. Approval and execution therefore do not maintain separate preview-building implementations.

## Production activation preflight

Production activation must begin with `preflightVkCommunityProductionActivation(...)`. The preflight accepts only non-secret metadata:

- exact positive VK Community ID;
- owner Ed25519 public verification key;
- VK credential Secret Provider reference;
- publishing-identity Secret Provider reference.

The preflight never receives a Secret Provider instance, never reads environment secret values, never performs network I/O, and never publishes. It returns either:

- `BLOCKED` with explicit reasons such as missing/invalid community ID, public key, or secret reference; or
- `READY` with sanitized metadata only: community ID, derived negative owner ID, owner public-key fingerprint, and the two opaque secret references.

A production destination must not be guessed from search results or a display name. The exact VK Community ID must be independently confirmed before it is bound to deployment configuration.

## Owner-side grant signing

The canonical owner grant payload is created with `createVkCommunityOwnerGrantAssertion(...)` and serialized by `serializeVkCommunityOwnerGrantAssertion(...)`.

`signVkCommunityOwnerGrant(...)` is intended only for the separate owner-side signing boundary. It requires a caller-supplied Ed25519 private `KeyObject`; the helper does not generate, persist, serialize, log, or return the private key. The ordinary publishing runtime must never receive that private key.

The owner signs only after inspecting the exact approval packet and confirming its publication ID, destination and preview fingerprint. The resulting short-lived grant may then be passed to `VkCommunityRuntimeController.execute(...)`, which re-verifies the same canonical payload using only the owner public key.

## Still owner-gated

The repository does not contain production VK token values, production HMAC key values, or an activated production deployment configuration. Tests use only fake/in-memory secrets and fake transports.

Before the first real post, the operator must still:

1. provision the production owner Ed25519 private signing key in an owner-side signing boundary outside the publishing runtime, repository, and AI-visible channels, and configure only its public verification key in the runtime;
2. provision the publishing-identity HMAC secret outside the repository and AI-visible channels;
3. provision the VK access token through the Secret Provider boundary;
4. bind the deployment to the exact VK Community ID;
5. bind the canonical PostgreSQL publication state to the read-only approval-packet reader, then generate and inspect the exact preview and preview fingerprint;
6. create a short-lived owner execution grant for that exact publication + destination + preview fingerprint;
7. execute the real publish only after the owner's explicit command.

## Evidence rules

Canonical evidence may contain publication ID, platform, destination owner ID, preview fingerprint, external post ID, deterministic idempotency key, safe result code, and timestamp. It must not contain access tokens, HMAC key material, owner private signing key material, raw VK responses, raw provider errors, cookies, session material, authorization headers, or inline secret values.


## Operator preflight CLI

TASK-015 adds a deliberately narrow operator command for production metadata validation:

```bash
pnpm --filter @yastroyka/orchestrator vk:preflight ./vk-production.json
```

The manifest is non-secret configuration only and may contain these top-level fields:

```json
{
  "communityId": 123456,
  "ownerApprovalPublicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
  "vkCredentialSecretReference": {
    "provider": "env",
    "key": "publishing/vk-community/yastroyka"
  },
  "publishingIdentitySecretReference": {
    "provider": "env",
    "key": "publishing/identity/vk-community/runtime"
  }
}
```

Do not put a VK access token, publishing-identity HMAC value, owner private signing key, cookie, session material, authorization header, or any other secret value in this manifest. Unknown top-level fields are rejected rather than ignored.

Exit codes are deterministic: `0` means READY, `2` means BLOCKED, `64` means usage error, and `65` means invalid manifest. READY/BLOCKED output is sanitized JSON from the canonical production preflight. The command has no Secret Provider dependency, no database access, no network transport, no grant signing, and no publish path.
